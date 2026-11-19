// V2.4 虚拟形象视频：独立窗口；只显示本地 Live2D/图片，不采集摄像头、不录像。
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const CALL_LABEL: &str = "video_call";

#[tauri::command]
pub async fn video_call_open(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(CALL_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(true);
    }

    WebviewWindowBuilder::new(&app, CALL_LABEL, WebviewUrl::App("call.html".into()))
        .title("和 ta 视频")
        .inner_size(760.0, 600.0)
        .min_inner_size(560.0, 460.0)
        .resizable(true)
        .decorations(true)
        .center()
        .visible(true)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn video_call_close(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(CALL_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(true)
}

#[tauri::command]
pub fn video_call_is_open(app: AppHandle) -> bool {
    app.get_webview_window(CALL_LABEL).is_some()
}
