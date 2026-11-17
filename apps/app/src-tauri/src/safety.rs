// Step 6 · 安全与备份（T29 / T33）
//
// - 备份：把 SQLCipher DB + db.key 封进 Argon2id + AES-256-GCM 的 .czbak 包；
//   媒体文件暂不打包（见 docs/step6-progress.md）。
// - 恢复：选择 .czbak + 口令 → 解封 → 写回 DB/key（旧库先复制 .before-restore）。
// - 销毁：删除 DB/WAL/SHM/key/media/logs，返回删除清单，不承诺"不可恢复"。

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

use tauri_plugin_dialog::DialogExt;

use crate::db::{seal, unseal};
use crate::store;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPayload {
    version: u32,
    exported_at: i64,
    db_base64: String,
    key: String,
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

fn export_at(dir: &Path, passphrase: &str, target: &Path) -> Result<(), String> {
    if passphrase.trim().len() < 6 {
        return Err("备份口令至少 6 位".to_string());
    }
    let db = fs::read(dir.join("changzai.db")).map_err(|e| format!("读取数据库失败：{e}"))?;
    let key = read_key(dir)?;
    let payload = BackupPayload {
        version: 1,
        exported_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        db_base64: STANDARD.encode(db),
        key,
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
    Ok(db_path)
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
        if path.exists() && fs::remove_file(&path).is_ok() {
            removed.push(name.to_string());
        }
    }
    for name in ["media", "logs"] {
        let path = dir.join(name);
        if path.exists() && fs::remove_dir_all(&path).is_ok() {
            removed.push(format!("{name}/"));
        }
    }
    removed
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    store::app_dir(app)
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

        let removed = destroy_at(&dir);
        assert!(removed.iter().any(|name| name == "changzai.db"));
        assert!(!dir.join("changzai.db").exists());
        assert!(!dir.join("media").exists());
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
