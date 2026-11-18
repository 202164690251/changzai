mod db;
mod http_probe;
mod llm;
mod media;
mod pet;
mod safety;
mod store;
mod stt;
mod tray;
mod tts;

use serde::Serialize;
use tauri::WindowEvent;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    tauri_version: String,
    os: String,
    arch: String,
    webview: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".to_string()),
    }
}

#[derive(Serialize)]
struct NotifyProbeResult {
    ok: bool,
    message: String,
}

#[tauri::command]
fn notify_probe(app: tauri::AppHandle, title: String, body: String) -> NotifyProbeResult {
    use tauri_plugin_notification::NotificationExt;
    match app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        Ok(()) => NotifyProbeResult {
            ok: true,
            message: "通知已提交给 Windows（若未弹出，检查通知权限/专注助手）".to_string(),
        },
        Err(err) => NotifyProbeResult {
            ok: false,
            message: format!("通知失败: {err}"),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            notify_probe,
            db::db_probe,
            http_probe::http_stream_probe,
            media::import_media_files,
            store::db_init,
            store::db_stats,
            store::import_persist,
            store::profile_save,
            store::profile_load,
            store::media_persist,
            store::pick_import_files,
            store::setting_get,
            store::setting_set,
            store::persona_save,
            store::persona_load,
            store::messages_load,
    store::chat_append,
    store::chat_load,
    store::chat_delete,
    store::chat_clear,
            store::memory_rebuild,
            store::memory_search,
            store::memory_count,
            llm::llm_config_load,
            llm::llm_config_save,
            llm::llm_test,
            llm::llm_chat_stream,
            stt::stt_transcribe,
            tts::tts_speak,
            tts::tts_voices,
            safety::backup_export,
            safety::backup_restore,
            safety::data_destroy,
            safety::pin_set,
            safety::pin_verify,
            safety::pin_disable,
            pet::pet_open,
            pet::pet_close,
            pet::pet_hide,
            pet::pet_is_open,
            pet::pet_open_main,
            pet::pet_start_drag,
            pet::pet_save_position,
            safety::pin_enabled
        ])
        .setup(|app| {
            // 托盘常驻：关闭窗口 = 隐藏，进程继续跑（主动消息的前提）
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
