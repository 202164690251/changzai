// Step 2 前置：回忆素材（图片/语音）导入。
// 由前端设置页触发：选择本地文件 → 校验类型/大小 → 复制到 app_data/media/imported
// → 返回 dataUrl（小图直接显示，避免再开 asset 协议权限）。
// 说明：真正的聊天记录媒体按 msg_id 入库（T35）在 Step 2 实现；这里先打通「选文件 → 展示气泡」链路。

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const MAX_FILES: usize = 20;
const MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    name: String,
    path: String,
    size: u64,
    kind: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaImportResult {
    ok: bool,
    files: Vec<MediaFile>,
    message: String,
}

fn label_and_exts(kind: &str) -> (&'static str, &'static [&'static str]) {
    match kind {
        "voice" => (
            "语音",
            &["mp3", "wav", "m4a", "aac", "ogg", "opus", "amr", "silk"],
        ),
        _ => ("图片", &["png", "jpg", "jpeg", "gif", "webp", "bmp"]),
    }
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "amr" => "audio/amr",
        "silk" => "audio/silk",
        _ => "image/jpeg",
    }
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "media".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn import_media_files(
    app: tauri::AppHandle,
    kind: String,
) -> Result<MediaImportResult, String> {
    let (label, exts) = label_and_exts(&kind);
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(format!("选择{label}文件（可多选）"))
        .add_filter(label, exts)
        .pick_files(move |paths| {
            let _ = tx.send(paths);
        });

    let picked = rx.await.map_err(|e| format!("dialog: {e}"))?;
    let Some(paths) = picked else {
        return Ok(MediaImportResult {
            ok: false,
            files: Vec::new(),
            message: "未选择文件".to_string(),
        });
    };

    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("media")
        .join("imported");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    let mut out: Vec<MediaFile> = Vec::new();
    let mut skipped = 0usize;
    for file_path in paths.into_iter().take(MAX_FILES) {
        let source = file_path.into_path().map_err(|e| e.to_string())?;
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !exts.contains(&ext.as_str()) {
            skipped += 1;
            continue;
        }
        let meta = match fs::metadata(&source) {
            Ok(m) => m,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if meta.len() == 0 || meta.len() > MAX_BYTES {
            skipped += 1;
            continue;
        }
        let bytes = match fs::read(&source) {
            Ok(b) => b,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let data_url = format!("data:{};base64,{}", mime_for(&ext), b64);
        let original_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("media")
            .to_string();
        let dest_name = format!("{}_{}", now_millis(), sanitize_file_name(&original_name));
        let dest = base.join(&dest_name);
        if fs::copy(&source, &dest).is_err() {
            skipped += 1;
            continue;
        }
        out.push(MediaFile {
            name: original_name,
            path: dest.display().to_string(),
            size: meta.len(),
            kind: if kind == "voice" { "voice".to_string() } else { "image".to_string() },
            data_url,
        });
    }

    let ok = !out.is_empty();
    let message = if ok {
        let mut m = format!("已导入 {} 个{label}", out.len());
        if skipped > 0 {
            m.push_str(&format!("，跳过 {skipped} 个不支持的文件"));
        }
        m
    } else {
        "没有可导入的有效文件（检查格式/大小）".to_string()
    };

    Ok(MediaImportResult {
        ok,
        files: out,
        message,
    })
}
