// Step 1 · 数据层技术自检
// 本机没有 Perl/NASM/OpenSSL，SQLCipher 的 vendored-OpenSSL 无法编译；
// 因此这里验证「plain SQLite + 应用层 AES-256-GCM 封装」的回退方案，
// 并验证 SQLite 本身、FTS5 trigram、Argon2id 是否可用。
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

#[derive(Serialize)]
pub struct ProbeStep {
    name: String,
    ok: bool,
    ms: u128,
    detail: Option<String>,
}

#[derive(Serialize)]
pub struct DbProbeResult {
    ok: bool,
    engine: String,
    sqlcipher: bool,
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

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| format!("argon2: {e}"))?;
    Ok(key)
}

fn seal(passphrase: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
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

fn unseal(passphrase: &str, blob: &[u8]) -> Result<Vec<u8>, String> {
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
        engine: "sqlite3 + aes-256-gcm (app layer fallback)".to_string(),
        sqlcipher: false,
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
        None => std::env::temp_dir().join(format!("changzai-probe-{}", std::process::id())),
    };
    if let Err(e) = fs::create_dir_all(&base) {
        result.error = Some(format!("create dir: {e}"));
        return result;
    }
    let db_path = base.join("probe.db");
    result.db_path = db_path.display().to_string();
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(base.join("seal.bin"));

    // 1) SQLite 建库/写入/重开读取
    let t = Instant::now();
    let sqlite_ok = (|| -> Result<i64, String> {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS probe(id INTEGER PRIMARY KEY, text TEXT);
             INSERT INTO probe(text) VALUES ('早点睡吧');",
        )
        .map_err(|e| e.to_string())?;
        drop(conn);
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT count(*) FROM probe", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count)
    })();
    match &sqlite_ok {
        Ok(count) => steps.push(step(
            "sqlite_open_write_reopen",
            *count == 1,
            t.elapsed().as_millis(),
            Some(format!("重开后 count={count}")),
        )),
        Err(e) => steps.push(step("sqlite_open_write_reopen", false, t.elapsed().as_millis(), Some(e.clone()))),
    }

    // 2) FTS5 + trigram（中文检索的前提）
    let t = Instant::now();
    let fts_probe = (|| -> Result<(i64, bool), String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, tokenize='trigram');
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

    // 3) Argon2id 派生 + AES-256-GCM 封装（回退加密方案）
    let t = Instant::now();
    let plaintext = "wx_20230520_0001 | 小林 | 明天降温，记得穿外套".as_bytes();
    let passphrase = "correct horse battery staple";
    let seal_ok = (|| -> Result<(bool, bool, bool, bool), String> {
        let blob = seal(passphrase, plaintext)?;
        let path = base.join("seal.bin");
        fs::write(&path, &blob).map_err(|e| e.to_string())?;
        let read = fs::read(&path).map_err(|e| e.to_string())?;
        let header_ok = read.starts_with(b"CZSEAL1\0");
        // 明文不得出现在封装文件中
        let leak = String::from_utf8_lossy(&read).contains("明天降温");
        let unlocked = unseal(passphrase, &read)?;
        let unlock_ok = unlocked == plaintext;
        let wrong_key_err = unseal("wrong passphrase", &read).is_err();
        Ok((header_ok, !leak, unlock_ok, wrong_key_err))
    })();
    match seal_ok {
        Ok((header_ok, no_leak, unlock_ok, wrong_key_err)) => {
            result.argon2id = true;
            result.app_layer_encryption = header_ok && no_leak && unlock_ok && wrong_key_err;
            steps.push(step(
                "aes256gcm_seal_unseal",
                result.app_layer_encryption,
                t.elapsed().as_millis(),
                Some(format!(
                    "header={header_ok} 无明文={no_leak} 正确口令可解={unlock_ok} 错误口令被拒={wrong_key_err}"
                )),
            ));
        }
        Err(e) => steps.push(step("aes256gcm_seal_unseal", false, t.elapsed().as_millis(), Some(e))),
    }

    // 4) SQLCipher 状态（本机因缺少 Perl/NASM/OpenSSL 未启用，如实记录）
    steps.push(step(
        "sqlcipher_available",
        false,
        0,
        Some("未启用：vendored-OpenSSL 需要 Perl + NASM + OpenSSL；当前用应用层加密回退，切换方式见报告".to_string()),
    ));

    result.steps = steps;
    result.ok = result.sqlcipher
        || (sqlite_ok.is_ok() && result.fts5 && result.trigram && result.app_layer_encryption);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_probe_passes() {
        let dir = std::env::temp_dir().join(format!("changzai-dbprobe-test-{}", std::process::id()));
        let result = db_probe(Some(dir.display().to_string()));
        assert!(
            result.ok,
            "db probe failed: error={:?} steps={:?}",
            result.error,
            result
                .steps
                .iter()
                .map(|s| format!("{}={}", s.name, s.ok))
                .collect::<Vec<_>>()
        );
        assert!(result.fts5, "FTS5 unavailable");
        assert!(result.trigram, "trigram tokenizer unavailable");
        assert!(result.argon2id, "argon2id unavailable");
        assert!(result.app_layer_encryption, "app-layer encryption failed");
        // 本机 Step 1 未启用 SQLCipher（缺 Perl/NASM/OpenSSL），如实断言：
        assert!(!result.sqlcipher);
    }
}
