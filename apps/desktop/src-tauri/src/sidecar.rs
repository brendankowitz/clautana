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
    /// Signalled once per observed process exit; `shutdown()` waits on this
    /// (bounded) to detect a clean exit before falling back to a hard kill.
    terminated_notify: Notify,
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
            terminated_notify: Notify::new(),
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

        self.guard.assign(child.pid())?;
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
                        this.terminated_notify.notify_one();

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
                        let _ = this.clone().start(app.clone());
                        return;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
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
        self.write(&framed)?;
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

        // Dropping the CommandChild drops its stdin pipe writer, closing our
        // end of the pipe and delivering EOF to the sidecar's stdin.
        drop(child);

        let exited = tokio::time::timeout(
            Duration::from_millis(SHUTDOWN_GRACE_MS),
            self.terminated_notify.notified(),
        )
        .await;

        if exited.is_err() {
            let _ = job::kill_pid(pid);
        }
    }

    fn route_line(&self, line: &str, app: &AppHandle) {
        if line.trim().is_empty() {
            return;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };

        let method = value.get("method").and_then(|m| m.as_str());

        // The sidecar's startup readiness signal is `{"method":"runtime.ready"}`.
        // It is not a RuntimeEvent and must not be forwarded to the webview
        // as one — surface it as its own Tauri event instead, and use it to
        // unblock any `rpc_call`s waiting on `wait_ready`.
        if method == Some("runtime.ready") {
            self.ready.store(true, Ordering::SeqCst);
            self.restart_attempt.store(0, Ordering::SeqCst);
            self.ready_notify.notify_waiters();
            let _ = app.emit("runtime-ready", ());
            return;
        }

        // Real events are shaped `{"method":"event","params":{...}}`. Route
        // on that exact shape, not on the mere presence of a "method" key —
        // otherwise `runtime.ready` (and any future non-event method-shaped
        // line) would be misrouted as a garbage RuntimeEvent.
        if method == Some("event") {
            let _ = app.emit("runtime-event", line.to_string());
            return;
        }

        if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
            if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                let _ = tx.send(line.to_string());
            }
        }
    }
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
    use super::backoff_delay_ms;

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
}
