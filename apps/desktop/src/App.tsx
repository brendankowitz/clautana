import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  RPC_ERROR_INVALID_PARAMS,
  type AgentStatus,
  type RuntimeEvent,
} from "@clautana/protocol";
import { RpcClient, RpcCallError } from "./rpc.js";
import { OutputStream } from "./components/OutputStream.js";
import "./App.css";

const rpc = new RpcClient((command, args) => invoke<string>(command, args));

interface UiError {
  message: string;
  /** RPC_ERROR_INVALID_PARAMS is a caller bug (bad input); anything else is
   * the server breaking. The two are surfaced with different severity. */
  severity: "invalid" | "internal";
}

function describeError(e: unknown): UiError {
  if (e instanceof RpcCallError) {
    return {
      message: e.message,
      severity: e.code === RPC_ERROR_INVALID_PARAMS ? "invalid" : "internal",
    };
  }
  return { message: e instanceof Error ? e.message : String(e), severity: "internal" };
}

function agentStatusClass(status: AgentStatus | undefined): string {
  switch (status) {
    case "processing":
      return "status-accent";
    case "interrupted":
      return "status-warning";
    case "error":
      return "status-danger";
    case "complete":
      return "status-success";
    case "idle":
    case "initializing":
    case "paused":
    case "waiting":
    default:
      return "status-muted";
  }
}

export default function App() {
  const [projectId, setProjectId] = useState<string>();
  const [agentId, setAgentId] = useState<string>();
  const [agentName, setAgentName] = useState<string>();
  const [agentStatus, setAgentStatus] = useState<AgentStatus>();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<UiError>();

  // Readiness is a gate, not a one-shot flag: the sidecar can restart after a
  // crash and re-emit `runtime-ready`. `readyGeneration` increments on every
  // occurrence, which both flips the UI back to "ready" and re-triggers the
  // events.subscribe effect below — the same lossless-reattach mechanism
  // handles a reopened window and a supervised sidecar restart alike.
  const [readyGeneration, setReadyGeneration] = useState(0);
  const [restarting, setRestarting] = useState(false);
  // Once the shell reports a failed restart, the sidecar is gone for good —
  // nothing will ever bring it back without relaunching the app. This is
  // sticky by design; it never clears itself.
  const [fatalMessage, setFatalMessage] = useState<string>();

  const lastSeq = useRef(0);
  const agentIdRef = useRef<string | undefined>(undefined);
  agentIdRef.current = agentId;

  const isReady = readyGeneration > 0 && !fatalMessage;

  useEffect(() => {
    const markReady = () => {
      setRestarting(false);
      setReadyGeneration((generation) => generation + 1);
    };

    const unlistenReady = listen("runtime-ready", markReady);

    // `runtime-ready` is a one-shot webview event with no replay: if the
    // sidecar (which typically reports ready in well under 100ms) beats this
    // component's mount and listener registration — a race that in practice
    // wins almost every cold start, since spawning the sidecar process is far
    // faster than the webview loading and running the React bundle — the
    // event fires into a page with no listener yet and is lost forever, and
    // the UI is stuck on "Starting…" even though the runtime is live and
    // idle. `rpc_call` on the Rust side already blocks on the same readiness
    // gate before writing anything (see `Runtime::call`/`wait_ready`), so a
    // harmless `runtime.ping` probed once at mount reaches the same
    // conclusion without depending on event delivery timing: it resolves the
    // instant the sidecar is ready (bounded by Rust's own 10s timeout) and
    // is a no-op past that point once `runtime-ready` events take over for
    // any later restart. This was found, not assumed: verified by observing
    // a real launch where the sidecar was alive and idle (near-zero CPU,
    // blocked on stdin as designed) while the UI stayed on "Starting…" with
    // no console errors.
    rpc
      .call("runtime.ping", {})
      .then(markReady)
      .catch((e: unknown) => setError(describeError(e)));

    const unlistenStatus = listen<string>("runtime-status", (message) => {
      const status = message.payload;
      if (status.startsWith("fatal:")) {
        setFatalMessage(status);
      } else if (status === "restarting") {
        setRestarting(true);
      }
    });

    const unlistenEvent = listen<string>("runtime-event", (message) => {
      const event = rpc.handleNotification(message.payload);
      if (!event || event.seq <= lastSeq.current) {
        return;
      }
      lastSeq.current = event.seq;
      setEvents((current) => [...current, event]);

      if (event.type === "agent.spawned" && event.agentId === agentIdRef.current) {
        setAgentName(event.name);
      }
      if (event.type === "agent.status" && event.agentId === agentIdRef.current) {
        setAgentStatus(event.status);
      }
    });

    return () => {
      void unlistenReady.then((off) => off());
      void unlistenStatus.then((off) => off());
      void unlistenEvent.then((off) => off());
    };
  }, []);

  useEffect(() => {
    // Gate on the readiness signal rather than firing on mount: the sidecar
    // may still be starting up (or restarting) when this component mounts,
    // and subscribing before `runtime-ready` would race an unready process.
    if (readyGeneration === 0) {
      return;
    }
    void rpc
      .call("events.subscribe", { sinceSeq: lastSeq.current })
      .catch((e: unknown) => setError(describeError(e)));
  }, [readyGeneration]);

  const openProject = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") {
      return;
    }
    try {
      const result = await rpc.call<{ projectId: string }>("project.open", { path: selected });
      setProjectId(result.projectId);
      setError(undefined);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  const spawnAgent = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await rpc.call<{ agentId: string }>("agent.spawn", {
        projectId,
        profile: "default",
      });
      setAgentId(result.agentId);
      setAgentName(undefined);
      setAgentStatus(undefined);
      setError(undefined);
    } catch (e) {
      setError(describeError(e));
    }
  }, [projectId]);

  const send = useCallback(async () => {
    if (!agentId || prompt.trim() === "") return;
    try {
      await rpc.call("agent.prompt", { agentId, text: prompt });
      setPrompt("");
      setError(undefined);
    } catch (e) {
      setError(describeError(e));
    }
  }, [agentId, prompt]);

  const interrupt = useCallback(async () => {
    if (!agentId) return;
    try {
      await rpc.call("agent.interrupt", { agentId });
      setError(undefined);
    } catch (e) {
      setError(describeError(e));
    }
  }, [agentId]);

  const runtimeStatusLabel = fatalMessage
    ? "Runtime unavailable"
    : restarting
      ? "Restarting…"
      : isReady
        ? "Ready"
        : "Starting…";
  const runtimeStatusClass = fatalMessage
    ? "status-danger"
    : restarting
      ? "status-warning"
      : isReady
        ? "status-success"
        : "status-muted";

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="app-name">Clautana</span>
        <span className={`status-pill ${runtimeStatusClass}`}>{runtimeStatusLabel}</span>
      </header>

      {fatalMessage && (
        <div className="banner banner-danger" role="alert">
          {fatalMessage} — restart the app to recover.
        </div>
      )}
      {!fatalMessage && restarting && (
        <div className="banner banner-warning" role="status">
          The runtime is restarting after an unexpected exit…
        </div>
      )}

      {error && (
        <div
          className={`banner ${error.severity === "internal" ? "banner-danger" : "banner-warning"}`}
          role="alert"
        >
          {error.message}
          <button className="banner-dismiss" onClick={() => setError(undefined)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="layout">
        <main className="main-pane">
          <div className="toolbar">
            <button onClick={() => void openProject()} disabled={!isReady}>
              Open project…
            </button>
            <button onClick={() => void spawnAgent()} disabled={!isReady || !projectId}>
              Spawn agent
            </button>
            <button onClick={() => void interrupt()} disabled={!isReady || !agentId}>
              Interrupt
            </button>
          </div>

          <OutputStream events={events} />

          <footer className="composer">
            <input
              value={prompt}
              placeholder="Send a prompt…"
              disabled={!isReady || !agentId}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <button onClick={() => void send()} disabled={!isReady || !agentId || prompt.trim() === ""}>
              Send
            </button>
          </footer>
        </main>

        <aside className="inspector-rail">
          <section className="inspector-section">
            <h2>Project</h2>
            <div className="inspector-row">
              <span className="inspector-label">ID</span>
              <span className="inspector-value mono">{projectId ?? "—"}</span>
            </div>
          </section>

          <section className="inspector-section">
            <h2>Agent</h2>
            <div className="inspector-row">
              <span className="inspector-label">Name</span>
              <span className="inspector-value">{agentName ?? "—"}</span>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">ID</span>
              <span className="inspector-value mono">{agentId ?? "—"}</span>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Status</span>
              <span className={`status-pill ${agentStatusClass(agentStatus)}`}>
                {agentStatus ?? "—"}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
