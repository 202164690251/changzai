// Step 6 · 安全与备份（T29 / T33）
//
// - 备份：把 SQLCipher DB + db.key 封进 Argon2id + AES-256-GCM 的 .czbak 包；
//   媒体文件暂不打包（见 docs/step6-progress.md）。
// - 恢复：选择 .czbak + 口令 → 解封 → 写回 DB/key（旧库先复制 .before-restore）。
// - 销毁：删除 DB/WAL/SHM/key/media/logs，返回删除清单，不承诺"不可恢复"。

use std::fs;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};

use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};

use tauri_plugin_dialog::DialogExt;

use crate::db::{seal, unseal};
use crate::store;

const MAX_BACKUP_MEDIA_BYTES: u64 = 150 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    path: String,
    data_base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPayload {
    version: u32,
    exported_at: i64,
    db_base64: String,
    key: String,
    #[serde(default)]
    media: Vec<BackupFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub ok: bool,
    pub path: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub ok: bool,
    pub message: String,
    pub backup_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestroyResult {
    pub ok: bool,
    pub removed: Vec<String>,
    pub message: String,
}

fn read_key(dir: &Path) -> Result<String, String> {
    let key = fs::read_to_string(dir.join("db.key")).map_err(|e| format!("读取密钥失败：{e}"))?;
    let key = key.trim().to_string();
    if key.len() != 64 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("密钥文件格式异常".to_string());
    }
    Ok(key)
}

fn collect_media(dir: &Path) -> Result<Vec<BackupFile>, String> {
    let root = dir.join("media");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut total = 0u64;
    let mut stack = vec![root.clone()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current).map_err(|e| format!("读取素材目录失败：{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            total += size;
            if total > MAX_BACKUP_MEDIA_BYTES {
                return Err("素材总大小超过 150MB，暂不支持打包；请先精简素材".to_string());
            }
            let relative = path
                .strip_prefix(&root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let data = fs::read(&path).map_err(|e| format!("读取素材失败：{e}"))?;
            out.push(BackupFile {
                path: relative,
                data_base64: STANDARD.encode(data),
            });
        }
    }
    Ok(out)
}

fn export_at(dir: &Path, passphrase: &str, target: &Path) -> Result<(), String> {
    if passphrase.trim().len() < 6 {
        return Err("备份口令至少 6 位".to_string());
    }
    let db = fs::read(dir.join("changzai.db")).map_err(|e| format!("读取数据库失败：{e}"))?;
    let key = read_key(dir)?;
    let media = collect_media(dir)?;
    let payload = BackupPayload {
        version: 1,
        exported_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        db_base64: STANDARD.encode(db),
        key,
        media,
    };
    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let sealed = seal(passphrase, &json)?;
    fs::write(target, sealed).map_err(|e| format!("写入备份失败：{e}"))
}

fn import_at(dir: &Path, passphrase: &str, source: &Path) -> Result<PathBuf, String> {
    let blob = fs::read(source).map_err(|e| format!("读取备份失败：{e}"))?;
    let plaintext = unseal(passphrase, &blob).map_err(|e| format!("解封失败：{e}"))?;
    let payload: BackupPayload =
        serde_json::from_slice(&plaintext).map_err(|e| format!("备份格式错误：{e}"))?;
    if payload.version != 1 {
        return Err("不支持的备份版本".to_string());
    }
    let db = STANDARD
        .decode(payload.db_base64)
        .map_err(|e| format!("备份数据损坏：{e}"))?;
    if payload.key.len() != 64 {
        return Err("备份里的密钥格式异常".to_string());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("changzai.db");
    if db_path.exists() {
        let backup = dir.join("changzai.db.before-restore");
        let _ = fs::copy(&db_path, &backup);
    }
    fs::write(&db_path, db).map_err(|e| format!("写入数据库失败：{e}"))?;
    fs::write(dir.join("db.key"), payload.key).map_err(|e| format!("写入密钥失败：{e}"))?;
    let _ = fs::remove_file(dir.join("changzai.db-wal"));
    let _ = fs::remove_file(dir.join("changzai.db-shm"));

    let media_root = dir.join("media");
    if media_root.exists() {
        let _ = fs::remove_dir_all(&media_root);
    }
    fs::create_dir_all(&media_root).map_err(|e| e.to_string())?;
    for file in payload.media {
        let relative = Path::new(&file.path);
        if relative.is_absolute() || file.path.contains("..") {
            continue;
        }
        let target = media_root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data = STANDARD.decode(file.data_base64).map_err(|e| e.to_string())?;
        fs::write(target, data).map_err(|e| format!("写入素材失败：{e}"))?;
    }
    Ok(db_path)
}

fn secure_remove_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let size = metadata.len();
    if size > 0 {
        if let Ok(mut file) = fs::OpenOptions::new().write(true).open(path) {
            let mut buffer = vec![0u8; 64 * 1024];
            for _ in 0..3 {
                let mut remaining = size;
                let _ = file.seek(std::io::SeekFrom::Start(0));
                while remaining > 0 {
                    let chunk = remaining.min(buffer.len() as u64) as usize;
                    thread_rng().fill_bytes(&mut buffer[..chunk]);
                    if file.write_all(&buffer[..chunk]).is_err() {
                        break;
                    }
                    remaining -= chunk as u64;
                }
                let _ = file.flush();
            }
        }
    }
    fs::remove_file(path).is_ok()
}

fn destroy_at(dir: &Path) -> Vec<String> {
    let mut removed = Vec::new();
    for name in [
        "changzai.db",
        "changzai.db-wal",
        "changzai.db-shm",
        "changzai.db.before-restore",
        "db.key",
    ] {
        let path = dir.join(name);
        if path.exists() && secure_remove_file(&path) {
            removed.push(name.to_string());
        }
    }
    for name in ["media", "logs"] {
        let path = dir.join(name);
        if path.exists() {
            let mut stack = vec![path.clone()];
            while let Some(current) = stack.pop() {
                if current.is_dir() {
                    if let Ok(entries) = fs::read_dir(&current) {
                        for entry in entries.flatten() {
                            stack.push(entry.path());
                        }
                    }
                } else {
                    let _ = secure_remove_file(&current);
                }
            }
            if fs::remove_dir_all(&path).is_ok() {
                removed.push(format!("{name}/"));
            }
        }
    }
    removed
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    store::app_dir(app)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn pin_digest(pin: &str, salt: &[u8]) -> Result<String, String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(pin.as_bytes(), salt, &mut key)
        .map_err(|e| format!("argon2: {e}"))?;
    Ok(hex(&key))
}

fn pin_set_at(dir: &Path, pin: &str) -> Result<(), String> {
    if pin.len() < 4 || pin.len() > 8 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN 需为 4–8 位数字".to_string());
    }
    let mut salt = [0u8; 16];
    thread_rng().fill_bytes(&mut salt);
    let hash = pin_digest(pin, &salt)?;
    store::write_setting_at(dir, "pin.salt", &hex(&salt))?;
    store::write_setting_at(dir, "pin.hash", &hash)?;
    Ok(())
}

fn pin_verify_at(dir: &Path, pin: &str) -> Result<bool, String> {
    let Some(salt) = store::read_setting_at(dir, "pin.salt")? else {
        return Ok(false);
    };
    if salt.trim().is_empty() {
        return Ok(false);
    }
    let Some(expected) = store::read_setting_at(dir, "pin.hash")? else {
        return Ok(false);
    };
    let salt_bytes = (0..salt.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&salt[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(pin_digest(pin, &salt_bytes)? == expected)
}

fn pin_disable_at(dir: &Path, pin: &str) -> Result<bool, String> {
    if !pin_verify_at(dir, pin)? {
        return Ok(false);
    }
    store::write_setting_at(dir, "pin.salt", "")?;
    store::write_setting_at(dir, "pin.hash", "")?;
    Ok(true)
}

#[tauri::command]
pub fn pin_set(app: tauri::AppHandle, pin: String) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    pin_set_at(&dir, &pin)?;
    Ok(true)
}

#[tauri::command]
pub fn pin_verify(app: tauri::AppHandle, pin: String) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    pin_verify_at(&dir, &pin)
}

#[tauri::command]
pub fn pin_disable(app: tauri::AppHandle, pin: String) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    pin_disable_at(&dir, &pin)
}

#[tauri::command]
pub fn pin_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    Ok(store::read_setting_at(&dir, "pin.hash")?
        .map(|value| value.len() == 64)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn backup_export(app: tauri::AppHandle, passphrase: String) -> Result<BackupResult, String> {
    if passphrase.trim().len() < 6 {
        return Err("备份口令至少 6 位".to_string());
    }
    let dir = app_data_dir(&app)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择备份保存位置")
        .set_file_name("changzai-backup.czbak")
        .add_filter("常在备份", &["czbak"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(path) = picked else {
        return Ok(BackupResult {
            ok: false,
            path: String::new(),
            message: "已取消备份".to_string(),
        });
    };
    let target = path.into_path().map_err(|e| e.to_string())?;
    export_at(&dir, &passphrase, &target)?;
    Ok(BackupResult {
        ok: true,
        path: target.display().to_string(),
        message: "备份完成。请把 .czbak 和口令分开保管。".to_string(),
    })
}

#[tauri::command]
pub async fn backup_restore(app: tauri::AppHandle, passphrase: String) -> Result<RestoreResult, String> {
    let dir = app_data_dir(&app)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择 .czbak 备份")
        .add_filter("常在备份", &["czbak"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(path) = picked else {
        return Ok(RestoreResult {
            ok: false,
            message: "已取消恢复".to_string(),
            backup_path: String::new(),
        });
    };
    let source = path.into_path().map_err(|e| e.to_string())?;
    let db_path = import_at(&dir, &passphrase, &source)?;
    Ok(RestoreResult {
        ok: true,
        message: "恢复完成。请重启常在，让新数据库生效。".to_string(),
        backup_path: db_path.display().to_string(),
    })
}

#[tauri::command]
pub fn data_destroy(app: tauri::AppHandle, confirm: String) -> Result<DestroyResult, String> {
    if confirm.trim() != "删除" {
        return Err("请输入「删除」确认".to_string());
    }
    let dir = app_data_dir(&app)?;
    let removed = destroy_at(&dir);
    Ok(DestroyResult {
        ok: true,
        removed,
        message: "已从本机删除数据库、密钥与素材。请重启应用；已删除内容不承诺可恢复。"
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_roundtrip_and_destroy() {
        let dir = std::env::temp_dir().join(format!("changzai-safety-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dir");
        fs::write(dir.join("changzai.db"), b"encrypted-db-bytes").expect("db");
        fs::write(dir.join("db.key"), "a".repeat(64)).expect("key");
        fs::create_dir_all(dir.join("media")).expect("media");
        fs::write(dir.join("media").join("a.png"), b"png").expect("media file");

        let backup = dir.join("backup.czbak");
        export_at(&dir, "passphrase", &backup).expect("export");
        assert!(backup.exists());

        fs::write(dir.join("changzai.db"), b"broken").expect("overwrite");
        import_at(&dir, "passphrase", &backup).expect("import");
        assert_eq!(fs::read(dir.join("changzai.db")).expect("read"), b"encrypted-db-bytes");
        assert_eq!(fs::read_to_string(dir.join("db.key")).expect("key"), "a".repeat(64));
        assert!(dir.join("media").join("a.png").exists());

        let removed = destroy_at(&dir);
        assert!(removed.iter().any(|name| name == "changzai.db"));
        assert!(!dir.join("changzai.db").exists());
        assert!(!dir.join("media").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pin_roundtrip() {
        let dir = std::env::temp_dir().join(format!("changzai-pin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dir");
        let conn = crate::store::open_at(&dir).expect("open");
        conn.execute_batch("CREATE TABLE IF NOT EXISTS setting(k TEXT PRIMARY KEY, v TEXT);")
            .expect("setting");
        drop(conn);
        pin_set_at(&dir, "1234").expect("set");
        assert!(pin_verify_at(&dir, "1234").expect("verify"));
        assert!(!pin_verify_at(&dir, "0000").expect("wrong"));
        assert!(pin_disable_at(&dir, "1234").expect("disable"));
        assert!(!pin_verify_at(&dir, "1234").expect("disabled"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let dir = std::env::temp_dir().join(format!("changzai-safety-wrong-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dir");
        fs::write(dir.join("changzai.db"), b"db").expect("db");
        fs::write(dir.join("db.key"), "b".repeat(64)).expect("key");
        let backup = dir.join("backup.czbak");
        export_at(&dir, "correct", &backup).expect("export");
        let result = import_at(&dir, "wrong", &backup);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
