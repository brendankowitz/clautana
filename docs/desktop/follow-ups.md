# Clautana Desktop — Known Gaps and Follow-Ups

State of slice 1 at merge. Everything here was found during review, judged
non-blocking, and deliberately carried rather than overlooked. Recorded so the
next slice starts from what is actually true.

## Never verified by execution

These are not known-broken. They are unproven, and each needs a human.

| What | Why it wasn't proven |
|---|---|
| **Installing the MSI and launching from `INSTALLDIR`** | Per-machine install needs UAC elevation that wasn't available. The installer builds (`Clautana_0.1.0_x64_en-US.msi`) and the release binary was exercised from a deliberately unwritable directory, but nobody has run the actual installed app. **This is the single most valuable manual check available.** |
| **The real Claude backend, end to end** | Every streaming test ran on `CLAUTANA_FAKE_BACKEND=1`. The SDK's dynamic-import resolution from the packaged binary was proven with a throwaway SEA build plus a negative control, but the real SDK load, its ~279MB first-run binary fetch, CLI auth pickup, and one genuine agent turn have never executed. Proving it costs money and needs supervision. |
| **Tray Quit on a release build** | Clicked through and verified on a debug build. The release path is source-traced through vendored Tauri — `app.exit(0)` → `ExitRequested` → `block_on(shutdown())` completes before the event loop exits — but not clicked. |
| **`tauri build` in CI** | CI gates the SDK-staging script and asserts the SDK lands correctly, but never runs a full bundle. A `bundle.resources` misconfiguration would ship green. |

> ⚠️ **When exercising the real backend, note:** sidecar stderr is persisted
> verbatim and unredacted to the diagnostics log under the app-data directory.
> Nothing sensitive can appear there today because only the fake backend runs.
> That changes the moment a real SDK writes to stderr.

## Follow-ups, roughly by value

**Wire `PROTOCOL_VERSION`.** It is produced by `runtime.ping` and consumed by
nothing — the UI uses that call purely as a readiness probe and discards the
result. Spec §7 promised a visible error on mismatch. Cheap, and it is the thing
that saves you when a stale sidecar bundle meets a newer UI.

**Make `onSubscribe` defensive** (`packages/runtime/src/main.ts`). Two concurrent
`events.subscribe` calls can interleave at the `await`, both register a listener,
and the loser leaks — double-writing every subsequent event to stdout. The shipped
frontend cannot trigger it (its readiness guard yields exactly one subscribe per
generation), which is why this ships. But the whole point of the sidecar is that
other headless clients can drive it, and the first one written without that
discipline reintroduces the bug with no seq-dedupe to mask it. Three lines.

**Close the `start()` TOCTOU window.** `shutdown_in_progress()` is checked at the
top of `start()`, but the child is not registered until after the OS spawn ~20
lines later. A `shutdown()` landing in that window sees no child and returns
without waiting for the process being created. The Job Object still reaps it — job
membership is assigned *before* the child is stored — so it dies, just not
gracefully. Window is milliseconds; pre-fix it was up to 30 seconds.

**`agent.kill` leaves the session in the pool.** A killed agent still answers
`get()`, still counts toward `activeCount`, and can be re-prompted — status
`complete` passes the `processing` guard, so a new query runs against a disposed
backend.

**A rejected mid-turn prompt is invisible.** `agent.prompt` acks immediately and
the rejection (agent already processing) only reaches `console.error`. The UI sees
`{ok:true}` and nothing happens. Either publish `agent.error` or disable Send
while processing — the Send path does not currently disable.

**Run directories accumulate.** One `runs/<uuid>/` per launch *and* per
crash-restart, never pruned.

**One cargo test doesn't discriminate what its name claims.**
`shutdown_is_a_safe_noop_once_the_child_slot_is_already_cleared` passes identically
before and after the fix it accompanies, because the fixture never populates the
child slot. Harmless, honestly disclosed, worth tightening.

## Deliberate deferrals — absent by design, not forgotten

From the spec's own "Deferred from the spec" table, all confirmed genuinely absent
with nothing silently depending on them:

- **App-tier persisted state** (project list, prefs, MCP registry, schedules) —
  projects reopen via the folder picker each launch.
- **OS keychain** — nothing needs a stored credential yet; arrives with MCP
  server credentials.
- **Crash-reload of in-flight runs** — a restart gets a fresh `runId` and the UI
  deliberately clears and resubscribes from 0 rather than half-depending on
  replay. Reload needs run-registry state from the run-engine slice.
- **PID lockfile and quit-prompt-on-active-agents** — the Windows Job Object is
  the hard guarantee; these were belt-and-braces on top of it. The quit prompt
  additionally needs an RPC exposing an active-agent count, which does not exist.

Also deferred by explicit ruling: `isRuntimeEvent` validates the event envelope
only, not per-variant fields — the sole producer is our own typed code, and the
distributive `EventDraft` gives compile-time checking on the publish side.

## Things it would be easy to undo by accident

- **`current_dir(resource_dir())` on the sidecar spawn is load-bearing.** The
  packaged binary resolves the SDK by walking up from `process.cwd()`. Remove the
  anchor and SDK resolution breaks for any launch that isn't a Windows-generated
  shortcut or an Explorer double-click.
- **`CLAUTANA_RUNS_DIR` must be passed on *every* spawn, not just the first.**
  Its absence is what made the installed app crash-loop: the default derives from
  cwd, which is now `INSTALLDIR` under `C:\Program Files\`.
- **Shutdown is stdin-close-first, and the ordering matters.** Windows
  `child.kill()` uses `TerminateProcess`, which the child cannot intercept, so
  closing stdin is the only way the sidecar flushes trailing events. Kill is the
  bounded fallback, not the mechanism.
- **`package:sea` chains `bundle`.** Running `bundle` separately is redundant;
  running `package:sea` alone is sufficient and correct.
