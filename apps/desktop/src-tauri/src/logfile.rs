//! Durable diagnostics log for the sidecar and its supervisor.
//!
//! `main.rs` sets `windows_subsystem = "windows"` for release builds, so
//! there is no console: `eprintln!` — including the sidecar's captured
//! stderr — goes nowhere once the app is installed. That leaves an agent
//! failure in a shipped build unexplainable.
//!
//! This module gives every diagnostic line a second, durable home: a capped
//! file under the Tauri app-data directory, timestamped and tagged by
//! source, so a failure in the installed app is still explainable after the
//! fact. `eprintln!` output is kept alongside it — this is additive, not a
//! replacement — so `cargo run` still shows everything inline.
//!
//! A logging failure must never take down the app or the supervisor: every
//! fallible operation here degrades to `eprintln!`-only rather than
//! propagating an error.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// Ceiling on the log file's size. An agent looping on an error could
/// otherwise fill the disk; once this is hit we stop appending (after
/// logging that fact once) rather than rotating — rotation is unneeded
/// complexity for slice 1.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB

const LOG_FILE_NAME: &str = "clautana-runtime.log";

/// Where a logged line came from, for the `[sidecar]` / `[shell]` tag. This
/// only labels the line's origin — the log never parses or interprets the
/// sidecar's output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// The sidecar process's own stderr, captured verbatim.
    Sidecar,
    /// A supervision event emitted by this shell (spawn, restart, shutdown, ...).
    Shell,
}

impl Source {
    fn tag(self) -> &'static str {
        match self {
            Source::Sidecar => "[sidecar]",
            Source::Shell => "[shell]",
        }
    }
}

/// Resolves the log file's path under the given app-data directory. Pure —
/// no filesystem or Tauri access — so it's unit-testable on its own.
fn resolve_log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOG_FILE_NAME)
}

/// Whether appending `incoming_len` more bytes to a file already holding
/// `current_len` bytes would exceed `cap`. Pure cap-decision logic, kept
/// separate from the I/O around it so it's unit-testable.
fn would_exceed_cap(current_len: u64, incoming_len: u64, cap: u64) -> bool {
    current_len.saturating_add(incoming_len) > cap
}

/// Durable, capped, append-only diagnostics log.
///
/// Every logged line also goes to `eprintln!` unconditionally; the file
/// append is best-effort on top of that. If the file can't be opened, can't
/// be written to, or has hit its size cap, the log silently falls back to
/// `eprintln!` only — it never returns an error or panics.
pub struct DiagnosticsLog {
    file: Mutex<Option<File>>,
    bytes_written: AtomicU64,
    cap_logged: AtomicBool,
}

impl DiagnosticsLog {
    /// Resolves the log path via Tauri's path API (never a hard-coded
    /// `%APPDATA%`), truncates any previous run's file, and prints the
    /// resolved path once so a user can be told where to look. If anything
    /// here fails — path resolution, directory creation, file open — the
    /// returned log degrades to `eprintln!` only; construction itself never
    /// fails, so it can never take the app down at startup.
    pub fn init(app: &AppHandle) -> Self {
        match Self::try_open(app) {
            Ok((file, path)) => {
                println!("[shell] diagnostics log: {}", path.display());
                Self {
                    file: Mutex::new(Some(file)),
                    bytes_written: AtomicU64::new(0),
                    cap_logged: AtomicBool::new(false),
                }
            }
            Err(err) => {
                eprintln!(
                    "[shell] diagnostics log unavailable ({err}); degrading to eprintln! only"
                );
                Self::disabled()
            }
        }
    }

    /// A log with no backing file — every `log()` call still reaches
    /// `eprintln!`. Used when file setup fails, and by tests that don't want
    /// a real `AppHandle`.
    pub fn disabled() -> Self {
        Self {
            file: Mutex::new(None),
            bytes_written: AtomicU64::new(0),
            cap_logged: AtomicBool::new(false),
        }
    }

    fn try_open(app: &AppHandle) -> Result<(File, PathBuf), String> {
        let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let path = resolve_log_path(&app_data_dir);
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        Ok((file, path))
    }

    /// Appends a timestamped, source-tagged line. Always echoes to
    /// `eprintln!` first — that path can't fail — then best-effort appends
    /// to the file.
    pub fn log(&self, source: Source, message: &str) {
        let line = format!("{} {} {}", timestamp(), source.tag(), message);
        eprintln!("{line}");
        self.append_to_file(&line);
    }

    fn append_to_file(&self, line: &str) {
        let mut slot = match self.file.lock() {
            Ok(slot) => slot,
            // A poisoned mutex means some other thread panicked while
            // holding it. Don't propagate that into the caller — just stop
            // trying to use the file.
            Err(_) => return,
        };
        let Some(file) = slot.as_mut() else { return };

        let incoming = line.len() as u64 + 1; // + newline
        let current = self.bytes_written.load(Ordering::SeqCst);
        if would_exceed_cap(current, incoming, MAX_LOG_BYTES) {
            if !self.cap_logged.swap(true, Ordering::SeqCst) {
                eprintln!(
                    "[shell] diagnostics log reached its {MAX_LOG_BYTES}-byte cap; further lines will not be written to the file"
                );
            }
            return;
        }

        if writeln!(file, "{line}").is_err() {
            // Drop the file handle so we stop paying for a failing write on
            // every subsequent line, rather than retrying forever.
            *slot = None;
            return;
        }
        self.bytes_written.fetch_add(incoming, Ordering::SeqCst);
    }

    /// Test-only constructor that writes to a real, already-open file so the
    /// cap and truncation behavior can be exercised without a `AppHandle`.
    #[cfg(test)]
    fn with_file(file: File) -> Self {
        Self {
            file: Mutex::new(Some(file)),
            bytes_written: AtomicU64::new(0),
            cap_logged: AtomicBool::new(false),
        }
    }
}

fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn resolve_log_path_joins_the_app_data_dir() {
        let dir = Path::new("C:/Users/example/AppData/Roaming/Clautana");
        assert_eq!(
            resolve_log_path(dir),
            PathBuf::from("C:/Users/example/AppData/Roaming/Clautana/clautana-runtime.log")
        );
    }

    #[test]
    fn would_exceed_cap_is_false_comfortably_under() {
        assert!(!would_exceed_cap(0, 100, 1_000));
    }

    #[test]
    fn would_exceed_cap_is_false_exactly_at_the_cap() {
        assert!(!would_exceed_cap(900, 100, 1_000));
    }

    #[test]
    fn would_exceed_cap_is_true_one_byte_over() {
        assert!(would_exceed_cap(900, 101, 1_000));
    }

    #[test]
    fn would_exceed_cap_does_not_overflow_on_huge_inputs() {
        assert!(would_exceed_cap(u64::MAX, 1, 1_000));
    }

    #[test]
    fn disabled_log_never_panics_and_writes_no_file() {
        let log = DiagnosticsLog::disabled();
        // Nothing to assert on the file side (there is none) — this is a
        // no-crash test for the degrade-to-eprintln-only path.
        log.log(Source::Shell, "spawn: starting sidecar");
        log.log(Source::Sidecar, "some captured stderr");
    }

    fn temp_file(name: &str) -> (PathBuf, File) {
        let path = std::env::temp_dir().join(format!(
            "clautana-logfile-test-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .truncate(true)
            .open(&path)
            .expect("failed to create temp file for test");
        (path, file)
    }

    #[test]
    fn log_writes_a_timestamped_tagged_line_to_the_file() {
        let (path, file) = temp_file("writes-line");
        let log = DiagnosticsLog::with_file(file);

        log.log(Source::Shell, "spawn: starting sidecar (attempt 0)");

        let mut contents = String::new();
        File::open(&path).unwrap().read_to_string(&mut contents).unwrap();
        std::fs::remove_file(&path).ok();

        assert!(contents.contains("[shell]"), "line missing [shell] tag: {contents}");
        assert!(
            contents.contains("spawn: starting sidecar (attempt 0)"),
            "line missing message: {contents}"
        );
        // RFC3339 timestamps always contain a 'T' separator between date and time.
        assert!(contents.contains('T'), "line missing timestamp: {contents}");
    }

    #[test]
    fn cap_stops_appending_once_reached_and_logs_only_once() {
        let (path, file) = temp_file("cap");
        let log = DiagnosticsLog::with_file(file);

        // Force the cap down to something a single short line already
        // exceeds, by writing directly against the real MAX_LOG_BYTES would
        // be slow — instead verify via bytes_written bookkeeping using a
        // line long enough to blow a much smaller local reasoning check.
        // Since MAX_LOG_BYTES is a module constant, drive this through many
        // small writes isn't practical in a fast test, so exercise
        // would_exceed_cap's integration by writing once, then asserting a
        // second write past a manually-shrunk remaining budget is skipped.
        //
        // Simplest faithful test: write one line, then poke bytes_written up
        // near the cap directly, then confirm the next line is dropped and
        // the file doesn't grow further.
        log.log(Source::Shell, "first line");
        log.bytes_written.store(MAX_LOG_BYTES, Ordering::SeqCst);

        log.log(Source::Shell, "this line must not be appended");
        log.log(Source::Shell, "neither must this one");

        let mut contents = String::new();
        File::open(&path).unwrap().read_to_string(&mut contents).unwrap();
        std::fs::remove_file(&path).ok();

        assert!(contents.contains("first line"));
        assert!(!contents.contains("this line must not be appended"));
        assert!(!contents.contains("neither must this one"));
        assert!(log.cap_logged.load(Ordering::SeqCst), "cap_logged flag was not set");
    }

    #[test]
    fn truncate_semantics_start_the_file_empty_on_open() {
        let path = std::env::temp_dir().join(format!(
            "clautana-logfile-test-truncate-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"stale content from a previous run\n").unwrap();

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        let log = DiagnosticsLog::with_file(file);
        log.log(Source::Shell, "fresh start");

        let mut contents = String::new();
        File::open(&path).unwrap().read_to_string(&mut contents).unwrap();
        std::fs::remove_file(&path).ok();

        assert!(!contents.contains("stale content"));
        assert!(contents.contains("fresh start"));
    }
}
