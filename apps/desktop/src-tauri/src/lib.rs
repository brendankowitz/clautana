mod job;
mod sidecar;
mod tray;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let runtime = sidecar::Runtime::spawn(app.handle())?;
            app.manage(Arc::clone(&runtime));
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar::rpc_call])
        .build(tauri::generate_context!())
        .expect("error while building Clautana")
        .run(|app_handle, event| {
            // Task 14 owns the full window/tray lifecycle; this hook only
            // guarantees the sidecar is torn down (stdin-close first, kill
            // as fallback — see sidecar::Runtime::shutdown) before the app
            // actually exits, rather than relying solely on the Job Object's
            // kill-on-close as a backstop.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let runtime = app_handle.state::<Arc<sidecar::Runtime>>().inner().clone();
                tauri::async_runtime::block_on(runtime.shutdown());
            }
        });
}
