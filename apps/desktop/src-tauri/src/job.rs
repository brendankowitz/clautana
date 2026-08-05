//! Guarantees the sidecar and every process it spawns die with the app.
//!
//! The Claude SDK spawns a `claude` executable as a child of the sidecar;
//! without OS-level containment, a force-quit of this app can strand those
//! processes, burning tokens with no UI left to stop them. Assigning the
//! sidecar to a Windows Job Object with `limit_kill_on_job_close` makes
//! teardown unconditional: when the job's last handle closes (this process
//! exiting, cleanly or not), Windows kills every process still in the job.

#[cfg(windows)]
pub struct ProcessGuard {
    job: win32job::Job,
}

#[cfg(windows)]
impl ProcessGuard {
    pub fn new() -> Result<Self, String> {
        let job = win32job::Job::create().map_err(|e| e.to_string())?;
        let mut info = job.query_extended_limit_info().map_err(|e| e.to_string())?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info).map_err(|e| e.to_string())?;
        Ok(Self { job })
    }

    /// Assigns a process (by PID) to the job object so it — and anything it
    /// spawns — dies when the job closes.
    ///
    /// `win32job::Job::assign_process` takes a process *handle*, not a PID.
    /// `CommandChild::pid()` only gives us a PID, so we must open a handle
    /// first via `OpenProcess`. The handle is closed again immediately after
    /// assignment; job membership is tracked by the kernel, not by us holding
    /// the handle open.
    pub fn assign(&self, pid: u32) -> Result<(), String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

        let handle = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) }
            .map_err(|e| e.to_string())?;

        let result = self
            .job
            .assign_process(handle.0 as isize)
            .map_err(|e| e.to_string());

        unsafe {
            let _ = CloseHandle(handle);
        }

        result
    }
}

#[cfg(not(windows))]
pub struct ProcessGuard;

#[cfg(not(windows))]
impl ProcessGuard {
    pub fn new() -> Result<Self, String> {
        Ok(Self)
    }

    pub fn assign(&self, _pid: u32) -> Result<(), String> {
        Ok(())
    }
}

/// Hard-kills a process by PID. This is the fallback teardown path, used
/// only when the sidecar doesn't exit within a bounded window after we close
/// its stdin. `TerminateProcess` (which this calls, transitively) bypasses
/// signal handlers entirely on Windows, so it must never be the primary path
/// — the sidecar's graceful shutdown (flushing final events) never runs.
#[cfg(windows)]
pub fn kill_pid(pid: u32) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(|e| e.to_string())?;
        let result = TerminateProcess(handle, 1).map_err(|e| e.to_string());
        let _ = CloseHandle(handle);
        result
    }
}

#[cfg(not(windows))]
pub fn kill_pid(_pid: u32) -> Result<(), String> {
    Ok(())
}
