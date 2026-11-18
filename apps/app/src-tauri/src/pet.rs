// V2.3 MVP：独立透明桌宠窗口。静态头像先跑通；Live2D 后续复用同一窗口。
use serde::Deserialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const PET_LABEL: &str = "pet";
const POSITION_KEY: &str = "pet.position";
const MINI_KEY: &str = "pet.mini";

#[derive(Debug, Clone, Deserialize)]
struct SavedPosition {
    x: i32,
    y: i32,
}

fn read_position(app: &AppHandle) -> Option<SavedPosition> {
    let dir = crate::store::app_dir(app).ok()?;
    let raw = crate::store::read_setting_at(&dir, POSITION_KEY).ok()??;
    serde_json::from_str(&raw).ok()
}

fn read_mini(app: &AppHandle) -> bool {
    crate::store::app_dir(app)
        .ok()
        .and_then(|dir| crate::store::read_setting_at(&dir, MINI_KEY).ok().flatten())
        .map(|value| value == "1")
        .unwrap_or(false)
}

fn write_mini(app: &AppHandle, mini: bool) -> Result<(), String> {
    let dir = crate::store::app_dir(app)?;
    crate::store::write_setting_at(&dir, MINI_KEY, if mini { "1" } else { "0" })
}

fn write_position(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let dir = crate::store::app_dir(app)?;
    let value = serde_json::json!({ "x": position.x, "y": position.y });
    crate::store::write_setting_at(&dir, POSITION_KEY, &value.to_string())
}



fn emit_visibility(app: &AppHandle, visible: bool) {
    let _ = app.emit_to("main", "pet://visibility", visible);
}

pub(crate) fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(PET_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub(crate) fn open(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_focus();
        emit_visibility(app, true);
        return Ok(true);
    }

    let mut builder = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::App("pet.html".into()))
        .title("常在桌宠")
        .inner_size(if read_mini(app) { 250.0 } else { 280.0 }, if read_mini(app) { 210.0 } else { 300.0 })
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(true);

    if let Some(position) = read_position(app) {
        builder = builder.position(position.x as f64, position.y as f64);
    } else {
        builder = builder.position(80.0, 80.0);
    }

    builder.build().map_err(|error| error.to_string())?;
    emit_visibility(app, true);
    Ok(true)
}

pub(crate) fn close(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    emit_visibility(app, false);
    Ok(true)
}

pub(crate) fn hide(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(PET_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    emit_visibility(app, false);
    Ok(true)
}

pub(crate) fn open_main(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        // 让主窗口切回聊天页；只打开程序不算“打开聊天”
        let _ = app.emit_to("main", "pet://open-chat", ());
    }
    Ok(true)
}

#[tauri::command]
pub async fn pet_open(app: AppHandle) -> Result<bool, String> {
    open(&app)
}

#[tauri::command]
pub async fn pet_close(app: AppHandle) -> Result<bool, String> {
    close(&app)
}

#[tauri::command]
pub async fn pet_hide(app: AppHandle) -> Result<bool, String> {
    hide(&app)
}

#[tauri::command]
pub fn pet_is_open(app: AppHandle) -> bool {
    is_visible(&app)
}

#[tauri::command]
pub async fn pet_open_main(app: AppHandle) -> Result<bool, String> {
    open_main(&app)
}

#[tauri::command]
pub fn pet_send_text(app: AppHandle, text: String) -> Result<bool, String> {
    let value = text.trim();
    if value.is_empty() {
        return Err("说点什么再发".into());
    }
    app.emit_to("main", "pet://quick-send", value.to_string())
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn pet_set_mini(app: AppHandle, window: WebviewWindow, mini: bool) -> Result<bool, String> {
    let size = if mini {
        LogicalSize::new(250.0, 210.0)
    } else {
        LogicalSize::new(280.0, 300.0)
    };
    window.set_size(size).map_err(|error| error.to_string())?;
    write_mini(&app, mini)?;
    Ok(true)
}

#[tauri::command]
pub fn pet_get_mini(app: AppHandle) -> bool {
    read_mini(&app)
}

#[tauri::command]
pub fn pet_set_chat_open(app: AppHandle, window: WebviewWindow, open: bool) -> Result<bool, String> {
    if read_mini(&app) {
        return Ok(false);
    }
    let size = if open {
        LogicalSize::new(280.0, 390.0)
    } else {
        LogicalSize::new(280.0, 300.0)
    };
    window.set_size(size).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn pet_start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn pet_save_position(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    write_position(&app, &window)
}
