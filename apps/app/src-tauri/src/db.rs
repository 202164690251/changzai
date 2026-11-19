// Step 1 · 数据层技术自检
// 1) SQLCipher：整库加密（PRAGMA key）、文件头不可读、错误口令被拒、重开可读；
// 2) FTS5：trigram 中文检索；
// 3) Argon2id + AES-256-GCM：导出包/字段级加密（未来端间迁移复用）。
// 构建前置：Perl + NASM + MSVC（见 docs/step1-spike-report.md §3）。
// 结论写回 docs/step1-spike-report.md。

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use rand::RngCore;
use rusqlite::Connection;
use serde::Serialize;

const PROBE_PASSPHRASE: &str = "correct horse battery staple";
const WRONG_PASSPHRASE: &str = "wrong passphrase";

#[derive(Serialize)]
pub struct ProbeStep {
    name: String,
    ok: bool,
    ms: u128,
    detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbProbeResult {
    ok: bool,
    engine: String,
    sqlcipher: bool,
    sqlcipher_header_encrypted: bool,
    sqlcipher_wrong_key_rejected: bool,
    app_layer_encryption: bool,
    fts5: bool,
    trigram: bool,
    argon2id: bool,
    db_path: String,
    steps: Vec<ProbeStep>,
    error: Option<String>,
}

fn step(name: &str, ok: bool, ms: u128, detail: Option<String>) -> ProbeStep {
    ProbeStep {
        name: name.to_string(),
        ok,
        ms,
        detail,
    }
}

fn open_sqlcipher(path: &std::path::Path, passphrase: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // PRAGMA key 必须是打开连接后的第一条语句；这是 SQLCipher 的硬约束。
    conn.execute_batch(&format!(
        "PRAGMA key = '{}';",
        passphrase.replace('\'', "''")
    ))?;
    // 触发一次真实读取，密钥错误会在这里报 "file is not a database"
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    Ok(conn)
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| format!("argon2: {e}"))?;
    Ok(key)
}

pub(crate) fn seal(passphrase: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("aes key: {e}"))?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|e| format!("aes encrypt: {e}"))?;
    let mut out = Vec::with_capacity(8 + salt.len() + nonce.len() + ciphertext.len());
    out.extend_from_slice(b"CZSEAL1\0");
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub(crate) fn unseal(passphrase: &str, blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < 8 + 16 + 12 || &blob[0..8] != b"CZSEAL1\0" {
        return Err("bad seal header".to_string());
    }
    let salt = &blob[8..24];
    let nonce = &blob[24..36];
    let ciphertext = &blob[36..];
    let key = derive_key(passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("aes key: {e}"))?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "decrypt failed (wrong passphrase?)".to_string())
}

#[tauri::command]
pub fn db_probe(dir: Option<String>) -> DbProbeResult {
    let mut steps: Vec<ProbeStep> = Vec::new();
    let mut result = DbProbeResult {
        ok: false,
        engine: "sqlcipher 4 + fts5(trigram) + aes-256-gcm(export)".to_string(),
        sqlcipher: false,
        sqlcipher_header_encrypted: false,
        sqlcipher_wrong_key_rejected: false,
        app_layer_encryption: false,
        fts5: false,
        trigram: false,
        argon2id: false,
        db_path: String::new(),
        steps: Vec::new(),
        error: None,
    };

    let base: PathBuf = match dir {
        Some(d) => PathBuf::from(d),
        None => std::env::temp_dir().join(format!("veyrimi-probe-{}", std::process::id())),
    };
    if let Err(e) = fs::create_dir_all(&base) {
        result.error = Some(format!("create dir: {e}"));
        return result;
    }
    let db_path = base.join("probe.db");
    result.db_path = db_path.display().to_string();
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(base.join("seal.bin"));
    let _ = fs::remove_file(base.join("probe.db-wal"));
    let _ = fs::remove_file(base.join("probe.db-shm"));

    // 1) SQLCipher 建库/写入/关闭/重开读取
    let t = Instant::now();
    let reopen_count = (|| -> Result<i64, String> {
        let conn = open_sqlcipher(&db_path, PROBE_PASSPHRASE).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS probe(id INTEGER PRIMARY KEY, text TEXT);
             INSERT INTO probe(text) VALUES ('早点睡吧');",
        )
        .map_err(|e| e.to_string())?;
        drop(conn);
        let conn = open_sqlcipher(&db_path, PROBE_PASSPHRASE).map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT count(*) FROM probe", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count)
    })();
    match &reopen_count {
        Ok(count) => steps.push(step(
            "sqlcipher_open_write_reopen",
            *count == 1,
            t.elapsed().as_millis(),
            Some(format!("重开后 count={count}")),
        )),
        Err(e) => steps.push(step(
            "sqlcipher_open_write_reopen",
            false,
            t.elapsed().as_millis(),
            Some(e.clone()),
        )),
    }

    // 2) 文件头不可读：SQLCipher 加密后前 16 字节不是 SQLite 明文头
    let t = Instant::now();
    match fs::read(&db_path) {
        Ok(bytes) => {
            let header_encrypted =
                bytes.len() >= 16 && &bytes[0..16] != b"SQLite format 3\0";
            result.sqlcipher_header_encrypted = header_encrypted;
            steps.push(step(
                "sqlcipher_header_encrypted",
                header_encrypted,
                t.elapsed().as_millis(),
                Some(format!(
                    "前16字节={:02X?}（明文头应为 53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00）",
                    bytes.get(0..16).unwrap_or(&[])
                )),
            ));
        }
        Err(e) => steps.push(step(
            "sqlcipher_header_encrypted",
            false,
            t.elapsed().as_millis(),
            Some(e.to_string()),
        )),
    }

    // 3) 错误口令必须被拒
    let t = Instant::now();
    let wrong_rejected = (|| -> bool {
        match open_sqlcipher(&db_path, WRONG_PASSPHRASE) {
            Ok(conn) => conn
                .query_row("SELECT count(*) FROM probe", [], |r| r.get::<_, i64>(0))
                .is_err(),
            Err(_) => true,
        }
    })();
    result.sqlcipher_wrong_key_rejected = wrong_rejected;
    steps.push(step(
        "sqlcipher_wrong_key_rejected",
        wrong_rejected,
        t.elapsed().as_millis(),
        Some(format!("错误口令是否被拒={wrong_rejected}")),
    ));

    // 4) FTS5 + trigram（中文检索的前提，在 SQLCipher 库内验证）
    let t = Instant::now();
    let fts_probe = (|| -> Result<(i64, bool), String> {
        let conn = open_sqlcipher(&db_path, PROBE_PASSPHRASE).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, tokenize='trigram');
             DELETE FROM fts;
             INSERT INTO fts(text) VALUES ('梧桐树下的约定'), ('雨伞和便利店');",
        )
        .map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT count(*) FROM fts WHERE fts MATCH '\"梧桐树\"'", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let trigram = count == 1;
        Ok((count, trigram))
    })();
    match fts_probe {
        Ok((count, trigram)) => {
            result.fts5 = true;
            result.trigram = trigram;
            steps.push(step(
                "fts5_trigram_zh",
                count == 1 && trigram,
                t.elapsed().as_millis(),
                Some(format!("MATCH 命中 {count} 条；trigram={trigram}")),
            ));
        }
        Err(e) => steps.push(step("fts5_trigram_zh", false, t.elapsed().as_millis(), Some(e))),
    }

    // 5) 导出包加密：Argon2id 派生 + AES-256-GCM 封装
    let t = Instant::now();
    let plaintext = "wx_20230520_0001 | ta | 明天降温，记得穿外套".as_bytes();
    let seal_ok = (|| -> Result<(bool, bool, bool, bool), String> {
        let blob = seal(PROBE_PASSPHRASE, plaintext)?;
        let path = base.join("seal.bin");
        fs::write(&path, &blob).map_err(|e| e.to_string())?;
        let read = fs::read(&path).map_err(|e| e.to_string())?;
        let header_ok = read.starts_with(b"CZSEAL1\0");
        let leak = String::from_utf8_lossy(&read).contains("明天降温");
        let unlocked = unseal(PROBE_PASSPHRASE, &read)?;
        let unlock_ok = unlocked == plaintext;
        let wrong_key_err = unseal(WRONG_PASSPHRASE, &read).is_err();
        Ok((header_ok, !leak, unlock_ok, wrong_key_err))
    })();
    match seal_ok {
        Ok((header_ok, no_leak, unlock_ok, wrong_key_err)) => {
            result.argon2id = true;
            result.app_layer_encryption = header_ok && no_leak && unlock_ok && wrong_key_err;
            steps.push(step(
                "export_aes256gcm_argon2id",
                result.app_layer_encryption,
                t.elapsed().as_millis(),
                Some(format!(
                    "header={header_ok} 无明文={no_leak} 正确口令可解={unlock_ok} 错误口令被拒={wrong_key_err}"
                )),
            ));
        }
        Err(e) => steps.push(step(
            "export_aes256gcm_argon2id",
            false,
            t.elapsed().as_millis(),
            Some(e),
        )),
    }

    result.sqlcipher = reopen_count.as_ref().map(|c| *c == 1).unwrap_or(false)
        && result.sqlcipher_header_encrypted
        && result.sqlcipher_wrong_key_rejected;
    result.steps = steps;
    result.ok = result.sqlcipher
        && result.fts5
        && result.trigram
        && result.app_layer_encryption;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_probe_passes() {
        let dir = std::env::temp_dir().join(format!("veyrimi-dbprobe-test-{}", std::process::id()));
        let result = db_probe(Some(dir.display().to_string()));
        assert!(
            result.ok,
            "db probe failed: error={:?} steps={:?}",
            result.error,
            result
                .steps
                .iter()
                .map(|s| format!("{}={} ({:?})", s.name, s.ok, s.detail))
                .collect::<Vec<_>>()
        );
        assert!(result.sqlcipher, "SQLCipher unavailable");
        assert!(result.sqlcipher_header_encrypted, "DB header is plaintext");
        assert!(result.sqlcipher_wrong_key_rejected, "wrong key accepted");
        assert!(result.fts5, "FTS5 unavailable");
        assert!(result.trigram, "trigram tokenizer unavailable");
        assert!(result.argon2id, "argon2id unavailable");
        assert!(result.app_layer_encryption, "export encryption failed");
    }
}
