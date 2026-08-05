use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Notify};

use crate::job::{self, ProcessGuard};

const MAX_BACKOFF_MS: u64 = 30_000;

/// Grace period after closing stdin before we give up on a clean exit and
/// fall back to a hard kill.
const SHUTDOWN_GRACE_MS: u64 = 2_000;

/// How long `rpc_call` will wait for `runtime.ready` before giving up. Covers
/// both first start and any in-flight restart after a crash.
const READY_TIMEOUT_MS: u64 = 10_000;

pub fn backoff_delay_ms(attempt: u32) -> u64 {
    let delay = 250u64.saturating_mul(1u64 << attempt.min(20));
    delay.min(MAX_BACKOFF_MS)
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<String>>>>;

pub struct Runtime {
    child: Mutex<Option<CommandChild>>,
    pending: Pending,
    next_id: AtomicI64,
    guard: ProcessGuard,
    /// Set once the current child has emitted `{"method":"runtime.ready"}`;
    /// cleared on every restart. Gates `rpc_call` so requests aren't written
    /// to a process that hasn't finished starting up.
    ready: AtomicBool,
    ready_notify: Notify,
    /// Set by `shutdown()` before it closes stdin, so the restart-on-exit
    /// logic in the reader task knows this termination was intentional and
    /// must not spawn a replacement.
    shutting_down: AtomicBool,
    /// Holds the completion half of a *fresh, per-attempt* oneshot channel
    /// while `shutdown()` is waiting for the child to exit. Deliberately not
    /// a long-lived shared `Notify`: `Notify::notify_one()` banks a permit
    /// when nobody is waiting, so a shared `Notify` fired by an earlier,
    /// ordinary crash-restart would let a *later* `shutdown()` call resolve
    /// instantly on that stale permit instead of actually waiting for the
    /// stdin-close-induced exit — silently skipping the flush window. A
    /// fresh oneshot per `shutdown()` call cannot carry state across
    /// attempts, so it cannot go stale. `None` unless a shutdown is
    /// in-flight; the `Terminated` handler is a no-op against `None`.
    shutdown_signal: Mutex<Option<oneshot::Sender<()>>>,
    /// Persists across restarts so backoff actually escalates on repeated
    /// crashes. Reset to 0 once a restarted process reports `runtime.ready`.
    /// (A plain local `attempt` inside the reader task would reset to 0 on
    /// every restart, since each restart spawns a brand-new task — that was
    /// the original design and never actually backed off.)
    restart_attempt: AtomicU32,
}

impl Runtime {
    pub fn spawn(app: &AppHandle) -> Result<Arc<Self>, String> {
        let guard = ProcessGuard::new()?;
        let runtime = Arc::new(Self {
            child: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicI64::new(1),
            guard,
            ready: AtomicBool::new(false),
            ready_notify: Notify::new(),
            shutting_down: AtomicBool::new(false),
            shutdown_signal: Mutex::new(None),
            restart_attempt: AtomicU32::new(0),
        });
        runtime.clone().start(app.clone())?;
        Ok(runtime)
    }

    fn start(self: Arc<Self>, app: AppHandle) -> Result<(), String> {
        self.ready.store(false, Ordering::SeqCst);

        let (mut rx, child) = app
            .shell()
            .sidecar("clautana-runtime")
            .map_err(|e| e.to_string())?
            .spawn()
            .map_err(|e| e.to_string())?;

        let pid = child.pid();

        // `CommandChild` has no `Drop` impl that kills the process — dropping
        // it only closes its stdin pipe. If job-object assignment fails here
        // (e.g. `OpenProcess` denied by AV/EDR), the child is already running
        // and unsupervised (nothing below this point runs: no reader task,
        // no restart, no readiness gating). Kill it before propagating the
        // error rather than letting it escape this function un-killed and
        // un-contained — exactly the orphan the job object exists to
        // prevent. `child.kill()` uses the handle `SharedChild` already
        // opened at spawn time, so — unlike `job::kill_pid`, which would
        // need a fresh `OpenProcess` call — it still works even if the same
        // AV/EDR policy that blocked `assign()` would also block a second
        // `OpenProcess`.
        if let Err(err) = self.guard.assign(pid) {
            let _ = child.kill();
            return Err(err);
        }

        *self.child.lock().unwrap() = Some(child);

        let this = self.clone();

        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes).to_string();
                        for part in line.lines() {
                            this.route_line(part, &app);
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        eprintln!("[runtime] {}", String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Terminated(_) => {
                        this.ready.store(false, Ordering::SeqCst);
                        this.signal_terminated();

                        // Fail any calls still waiting on a response rather
                        // than leaving their awaiters parked forever.
                        for (_, tx) in this.pending.lock().unwrap().drain() {
                            drop(tx);
                        }

                        if this.shutting_down.load(Ordering::SeqCst) {
                            // Intentional teardown (see `shutdown()`) — do
                            // not resurrect the process.
                            return;
                        }

                        let attempt = this.restart_attempt.fetch_add(1, Ordering::SeqCst);
                        let delay = backoff_delay_ms(attempt);
                        let _ = app.emit("runtime-status", "restarting");
                        tokio::time::sleep(Duration::from_millis(delay)).await;

                        // A failed restart is not a transient blip: it means
                        // no reader task, no backoff, no readiness gating,
                        // and no routing will ever run again for this
                        // Runtime. Silently discarding that (as `let _ =`
                        // would) leaves the app looking alive while the
                        // supervisor is permanently dead. Surface it.
                        if let Err(err) = this.clone().start(app.clone()) {
                            eprintln!("[runtime] restart failed permanently: {err}");
                            let _ = app.emit("runtime-status", format!("fatal: restart failed: {err}"));
                        }
                        return;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Completes any in-flight `shutdown()` wait. A no-op if no `shutdown()`
    /// call is currently waiting — see the `shutdown_signal` field doc for
    /// why this can't go stale the way a shared `Notify` would.
    fn signal_terminated(&self) {
        if let Some(tx) = self.shutdown_signal.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }

    async fn wait_ready(&self) {
        loop {
            if self.ready.load(Ordering::SeqCst) {
                return;
            }
            // Register interest before re-checking, so a `runtime.ready`
            // that lands between the first check and now isn't missed.
            let notified = self.ready_notify.notified();
            if self.ready.load(Ordering::SeqCst) {
                return;
            }
            notified.await;
        }
    }

    pub async fn call(&self, payload: String) -> Result<String, String> {
        tokio::time::timeout(Duration::from_millis(READY_TIMEOUT_MS), self.wait_ready())
            .await
            .map_err(|_| "runtime did not become ready in time".to_string())?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        // The UI sends a bodyless method+params object; Rust owns id assignment
        // so responses can be correlated without inspecting the payload.
        let framed = inject_id(&payload, id)?;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(err) = self.write(&framed) {
            // Don't leave an orphaned sender behind on the error path. The
            // next `Terminated` event would drain it anyway (so no caller
            // hangs today), but cleaning up here doesn't depend on that.
            self.pending.lock().unwrap().remove(&id);
            return Err(err);
        }
        rx.await.map_err(|_| "runtime closed before responding".to_string())
    }

    pub fn write(&self, payload: &str) -> Result<(), String> {
        let mut slot = self.child.lock().unwrap();
        let child = slot.as_mut().ok_or("runtime is not running")?;
        child
            .write(format!("{payload}\n").as_bytes())
            .map_err(|e| e.to_string())
    }

    /// Gracefully tears down the running sidecar. Closing stdin (EOF) is the
    /// primary path: the sidecar's shutdown handler flushes pending stdout
    /// writes — e.g. final `agent.status` events — before exiting once it
    /// observes EOF. A Rust-level `.kill()` uses `TerminateProcess` on
    /// Windows, which the child cannot intercept, so it is only the fallback
    /// after a bounded grace period.
    pub async fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);

        let child = self.child.lock().unwrap().take();
        let Some(child) = child else { return };
        let pid = child.pid();

        // Register a fresh, single-use completion signal *before* closing
        // stdin, so the `Terminated` event this triggers can't race ahead of
        // us starting to wait on it.
        let (tx, rx) = oneshot::channel();
        *self.shutdown_signal.lock().unwrap() = Some(tx);

        // Dropping the CommandChild drops its stdin pipe writer, closing our
        // end of the pipe and delivering EOF to the sidecar's stdin.
        drop(child);

        let exited = tokio::time::timeout(Duration::from_millis(SHUTDOWN_GRACE_MS), rx).await;

        if !matches!(exited, Ok(Ok(()))) {
            // Either the timeout elapsed, or the sender was dropped without
            // sending (shouldn't happen on this path, but treat the same as
            // "didn't confirm exit" rather than assuming success).
            self.shutdown_signal.lock().unwrap().take();
            let _ = job::kill_pid(pid);
        }
    }

    fn route_line(&self, line: &str, app: &AppHandle) {
        match classify_line(line) {
            RoutedLine::Ready => {
                self.ready.store(true, Ordering::SeqCst);
                self.restart_attempt.store(0, Ordering::SeqCst);
                self.ready_notify.notify_waiters();
                let _ = app.emit("runtime-ready", ());
            }
            RoutedLine::Event(raw) => {
                let _ = app.emit("runtime-event", raw);
            }
            RoutedLine::Response { id, raw } => {
                if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(raw);
                }
            }
            RoutedLine::Ignored => {}
        }
    }
}

/// The outcome of classifying one line of the sidecar's stdout. Pure JSON
/// logic, deliberately factored out of `Runtime::route_line` so it can be
/// unit tested without a live `AppHandle`.
#[derive(Debug, PartialEq, Eq)]
enum RoutedLine {
    /// `{"method":"runtime.ready"}` — the sidecar's startup readiness
    /// signal, not a `RuntimeEvent`.
    Ready,
    /// `{"method":"event","params":{...}}` — a real `RuntimeEvent`, to be
    /// forwarded to the webview verbatim.
    Event(String),
    /// `{"id":N,"result":...}` or `{"id":N,"error":...}` — a response to a
    /// specific in-flight `rpc_call`.
    Response { id: i64, raw: String },
    /// Empty, malformed, or a shape none of the above recognise.
    Ignored,
}

fn classify_line(line: &str) -> RoutedLine {
    if line.trim().is_empty() {
        return RoutedLine::Ignored;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return RoutedLine::Ignored;
    };

    let method = value.get("method").and_then(|m| m.as_str());

    // The sidecar's startup readiness signal is `{"method":"runtime.ready"}`.
    // It is not a RuntimeEvent and must not be forwarded to the webview as
    // one.
    if method == Some("runtime.ready") {
        return RoutedLine::Ready;
    }

    // Real events are shaped `{"method":"event","params":{...}}`. Route on
    // that exact shape, not on the mere presence of a "method" key —
    // otherwise `runtime.ready` (and any future non-event method-shaped
    // line) would be misrouted as a garbage RuntimeEvent.
    if method == Some("event") {
        return RoutedLine::Event(line.to_string());
    }

    if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
        return RoutedLine::Response { id, raw: line.to_string() };
    }

    RoutedLine::Ignored
}

fn inject_id(payload: &str, id: i64) -> Result<String, String> {
    let mut value: serde_json::Value = serde_json::from_str(payload).map_err(|e| e.to_string())?;
    value["id"] = serde_json::Value::from(id);
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rpc_call(app: AppHandle, payload: String) -> Result<String, String> {
    let runtime = app.state::<Arc<Runtime>>();
    runtime.call(payload).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_exponentially_from_250ms() {
        assert_eq!(backoff_delay_ms(0), 250);
        assert_eq!(backoff_delay_ms(1), 500);
        assert_eq!(backoff_delay_ms(2), 1000);
    }

    #[test]
    fn backoff_is_capped_at_thirty_seconds() {
        assert_eq!(backoff_delay_ms(20), 30_000);
    }

    // -- classify_line: the routing decision that finding #1 (readiness vs.
    // RuntimeEvent misrouting) lives in. Pure function, no AppHandle needed.

    #[test]
    fn classifies_the_readiness_signal() {
        assert_eq!(classify_line(r#"{"method":"runtime.ready"}"#), RoutedLine::Ready);
    }

    #[test]
    fn classifies_a_real_event_by_its_exact_shape() {
        let line = r#"{"method":"event","params":{"type":"agent.status","seq":1}}"#;
        assert_eq!(classify_line(line), RoutedLine::Event(line.to_string()));
    }

    #[test]
    fn classifies_a_success_response_by_id() {
        let line = r#"{"id":7,"result":{"ok":true}}"#;
        assert_eq!(
            classify_line(line),
            RoutedLine::Response { id: 7, raw: line.to_string() }
        );
    }

    #[test]
    fn classifies_an_error_response_by_id() {
        let line = r#"{"id":7,"error":{"code":"RPC_ERROR","message":"bad params"}}"#;
        assert_eq!(
            classify_line(line),
            RoutedLine::Response { id: 7, raw: line.to_string() }
        );
    }

    #[test]
    fn ignores_a_method_shaped_line_that_is_neither_ready_nor_event_and_has_no_id() {
        // Guards against a regression back to "any `method` key routes as an
        // event" — this line has a `method` key but isn't `runtime.ready` or
        // `event`, and carries no `id` to correlate as a response either.
        assert_eq!(classify_line(r#"{"method":"something.else"}"#), RoutedLine::Ignored);
    }

    #[test]
    fn ignores_malformed_json() {
        assert_eq!(classify_line("not json"), RoutedLine::Ignored);
    }

    #[test]
    fn ignores_an_empty_line() {
        assert_eq!(classify_line(""), RoutedLine::Ignored);
        assert_eq!(classify_line("   "), RoutedLine::Ignored);
    }

    // -- Runtime-level behavior that doesn't need a live AppHandle/process.

    fn test_runtime() -> Runtime {
        Runtime {
            child: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicI64::new(1),
            guard: ProcessGuard::new().expect("failed to create test job object"),
            ready: AtomicBool::new(false),
            ready_notify: Notify::new(),
            shutting_down: AtomicBool::new(false),
            shutdown_signal: Mutex::new(None),
            restart_attempt: AtomicU32::new(0),
        }
    }

    #[tokio::test]
    async fn stale_termination_does_not_short_circuit_a_later_shutdown_wait() {
        // Regression test for review finding #2: a shared `Notify` banks a
        // permit on `notify_one()` even when nobody is waiting, so an
        // ordinary crash-restart's `Terminated` event (which fires this same
        // signal) could let a *later* `shutdown()` resolve instantly on that
        // stale permit instead of actually waiting for the real exit.
        let runtime = test_runtime();

        // Simulate a crash-restart's Terminated event happening *before* any
        // shutdown() has registered interest - the exact scenario the old
        // shared-Notify design got wrong.
        runtime.signal_terminated();

        // Now simulate the start of a real shutdown wait, same as
        // `shutdown()` does: register a fresh receiver only after the stale
        // signal above.
        let (tx, rx) = oneshot::channel();
        *runtime.shutdown_signal.lock().unwrap() = Some(tx);

        let waited = tokio::time::timeout(Duration::from_millis(50), rx).await;
        assert!(
            waited.is_err(),
            "shutdown wait resolved instantly on a stale signal from an earlier, unrelated termination"
        );
    }

    #[tokio::test]
    async fn a_termination_after_shutdown_starts_waiting_does_complete_it() {
        // The inverse of the above: once shutdown() *has* registered
        // interest, the next Terminated event must still unblock it.
        let runtime = test_runtime();

        let (tx, rx) = oneshot::channel();
        *runtime.shutdown_signal.lock().unwrap() = Some(tx);

        runtime.signal_terminated();

        let waited = tokio::time::timeout(Duration::from_millis(50), rx).await;
        assert!(matches!(waited, Ok(Ok(()))), "a live shutdown wait was not completed by signal_terminated()");
    }

    #[tokio::test]
    async fn call_removes_its_pending_entry_when_write_fails() {
        // Fold-in fix: previously, a write() failure after the oneshot
        // sender was inserted into `pending` left that entry behind. It
        // self-healed on the next Terminated drain, but shouldn't rely on
        // that. No child is running here, so write() always fails.
        let runtime = test_runtime();
        runtime.ready.store(true, Ordering::SeqCst); // bypass the readiness gate

        let result = runtime.call(r#"{"method":"runtime.ping","params":{}}"#.to_string()).await;

        assert!(result.is_err());
        assert!(runtime.pending.lock().unwrap().is_empty());
    }
}
