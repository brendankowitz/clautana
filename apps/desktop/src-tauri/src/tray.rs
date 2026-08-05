//! System tray icon and window lifecycle.
//!
//! The window is a viewer onto the sidecar-owned run engine, not the engine
//! itself: closing it must never kill an in-flight or scheduled agent run.
//! So the window's close button hides the window instead of destroying it,
//! and the only way to actually exit the app is the tray's "Quit" item (or
//! an OS-level force-quit, which the Job Object in `job.rs` still contains).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Manager, WindowEvent};

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show Clautana", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            // `app.exit(0)` fires `RunEvent::ExitRequested`, which is where
            // `lib.rs` runs `Runtime::shutdown()` (stdin-close first, kill
            // as a bounded fallback) before the process actually exits.
            // Quit deliberately does not call `shutdown()` itself — that
            // would create a second shutdown path racing the one in
            // `lib.rs`. Going through `exit()` keeps there being exactly
            // one.
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let handle = window.clone();
        window.on_window_event(move |event| {
            // Closing the window hides it; the sidecar and any runs it is
            // supervising keep going with no window attached. That is the
            // entire point of being tray-resident.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = handle.hide();
            }
        });
    }

    Ok(())
}
