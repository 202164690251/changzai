// Step 2 · 本地 SQLCipher 数据层（导入持久化 / 体检报告 / 双方资料 / 媒体记录）
//
// 设计：
// - DB 文件：<app_data>/changzai.db，SQLCipher 整库加密；
// - key：<app_data>/db.key（32 字节随机 → 64 hex，首启生成；Step 6 接 Windows 凭据管理器）；
// - schema：由前端调用 `db_init(ddl)` 执行（DDL 唯一事实源在 packages/core/src/db/ddl.ts）；
// - 本模块只服务本地单用户，不做迁移框架；DDL 使用 IF NOT EXISTS，后续按 schema_version 演进。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use encoding_rs::GB18030;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const KEY_FILE: &str = "db.key";
const DB_FILE: &str = "changzai.db";
const MAX_IMPORT_FILES: usize = 20;
const MAX_IMPORT_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))
}

fn load_or_create_key(dir: &Path) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| format!("create dir: {e}"))?;
    let key_path = dir.join(KEY_FILE);
    if let Ok(existing) = fs::read_to_string(&key_path) {
        let key = existing.trim().to_string();
        if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(key);
        }
    }
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    fs::write(&key_path, &key).map_err(|e| format!("write key: {e}"))?;
    Ok(key)
}

pub(crate) fn open_at(dir: &Path) -> Result<Connection, String> {
    let key = load_or_create_key(dir)?;
    let path = dir.join(DB_FILE);
    let conn = Connection::open(&path).map_err(|e| format!("open db: {e}"))?;
    // SQLCipher raw key：x'<64 hex>'，必须是打开连接后的第一条语句
    conn.execute_batch(&format!("PRAGMA key = \"x'{key}'\";"))
        .map_err(|e| format!("pragma key: {e}"))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|e| format!("db key check: {e}"))?;
    Ok(conn)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub ok: bool,
    pub db_path: String,
    pub message_count: i64,
    pub her_count: i64,
    pub span_days: i64,
    pub holdout_count: i64,
    pub last_import_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMessage {
    pub id: String,
    pub conv_id: String,
    pub ts: i64,
    pub sender: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub media_path: Option<String>,
    pub reply_to: Option<String>,
    pub latency_s: Option<i64>,
    pub burst_index: i64,
    pub burst_size: i64,
    pub is_holdout: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPayload {
    pub source_names: Vec<String>,
    pub messages: Vec<ImportMessage>,
    pub report: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInitResult {
    pub ok: bool,
    pub db_path: String,
    pub message_count: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistResult {
    pub ok: bool,
    pub inserted: i64,
    pub holdout: i64,
    pub db_path: String,
    pub message_count: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSide {
    pub name: String,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePayload {
    pub her: ProfileSide,
    pub me: ProfileSide,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedImportFile {
    pub name: String,
    pub path: String,
    pub text: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickImportResult {
    pub ok: bool,
    pub files: Vec<PickedImportFile>,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPersistItem {
    #[allow(dead_code)]
    pub name: String,
    pub path: String,
    pub size: i64,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPersistResult {
    pub ok: bool,
    pub inserted: i64,
    pub message: String,
}

fn stats_for(conn: &Connection, dir: &Path) -> Result<DbStats, String> {
    let db_path = dir.join(DB_FILE).display().to_string();
    if !table_exists(conn, "message")? {
        return Ok(DbStats {
            ok: false,
            db_path,
            message_count: 0,
            her_count: 0,
            span_days: 0,
            holdout_count: 0,
            last_import_at: None,
        });
    }
    let message_count: i64 = conn
        .query_row("SELECT count(*) FROM message", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let her_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM message WHERE sender = 'her'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let holdout_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM message WHERE is_holdout = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let (min_ts, max_ts): (Option<i64>, Option<i64>) = conn
        .query_row("SELECT min(ts), max(ts) FROM message", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|e| e.to_string())?;
    let span_days = match (min_ts, max_ts) {
        (Some(min), Some(max)) if max > min => ((max - min) / 86_400_000).max(1),
        _ => 0,
    };
    let last_import_at: Option<i64> = conn
        .query_row(
            "SELECT CAST(v AS INTEGER) FROM setting WHERE k = 'import.last_at'",
            [],
            |row| row.get(0),
        )
        .ok();
    Ok(DbStats {
        ok: true,
        db_path,
        message_count,
        her_count,
        span_days,
        holdout_count,
        last_import_at,
    })
}

fn persist_payload_at(dir: &Path, payload: &ImportPayload) -> Result<PersistResult, String> {
    if payload.messages.is_empty() {
        return Err("没有可写入的消息".to_string());
    }
    let mut conn = open_at(dir)?;
    if !table_exists(&conn, "message")? {
        return Err("数据库尚未初始化，请先调用 db_init".to_string());
    }
    let now = now_ms();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO persona(id, name, created_at, status) VALUES ('persona_default', COALESCE((SELECT name FROM persona WHERE id='persona_default'), '她'), ?1, 'active')",
        params![now],
    )
    .map_err(|e| e.to_string())?;

    let mut holdout = 0i64;
    for message in &payload.messages {
        if message.is_holdout == 1 {
            holdout += 1;
        }
        tx.execute(
            "INSERT OR REPLACE INTO message(
                id, persona_id, conv_id, ts, sender, type, content, media_path,
                reply_to, latency_s, burst_index, burst_size, is_holdout
             ) VALUES (?1,'persona_default',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                message.id,
                message.conv_id,
                message.ts,
                message.sender,
                message.msg_type,
                message.content,
                message.media_path,
                message.reply_to,
                message.latency_s,
                message.burst_index,
                message.burst_size,
                message.is_holdout
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let job_id = format!("job_{now}");
    let sources = payload.source_names.join(",");
    tx.execute(
        "INSERT OR REPLACE INTO ingest_job(id, file_name, status, stage, processed, total, created_at, updated_at)
         VALUES (?1, ?2, 'done', 'done', ?3, ?3, ?4, ?4)",
        params![job_id, sources, payload.messages.len() as i64, now],
    )
    .map_err(|e| e.to_string())?;

    let report_json = serde_json::to_string(&payload.report).map_err(|e| e.to_string())?;
    for (key, value) in [
        ("import.report", report_json),
        ("import.last_at", now.to_string()),
        ("import.sources", sources),
    ] {
        tx.execute(
            "INSERT OR REPLACE INTO setting(k, v) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    let stats = stats_for(&conn, dir)?;
    Ok(PersistResult {
        ok: true,
        inserted: payload.messages.len() as i64,
        holdout,
        db_path: stats.db_path,
        message_count: stats.message_count,
        error: None,
    })
}

fn profile_save_at(dir: &Path, profile: &ProfilePayload) -> Result<(), String> {
    let mut conn = open_at(dir)?;
    if !table_exists(&conn, "profile")? {
        return Err("数据库尚未初始化".to_string());
    }
    let now = now_ms();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (id, side) in [("her", &profile.her), ("me", &profile.me)] {
        tx.execute(
            "INSERT INTO profile(id, display_name, avatar_path, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name,
               avatar_path = excluded.avatar_path, updated_at = excluded.updated_at",
            params![id, side.name, side.avatar, now],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn profile_load_at(dir: &Path) -> Result<Option<ProfilePayload>, String> {
    let conn = open_at(dir)?;
    if !table_exists(&conn, "profile")? {
        return Ok(None);
    }
    let mut statement = conn
        .prepare("SELECT id, display_name, avatar_path FROM profile")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut her: Option<ProfileSide> = None;
    let mut me: Option<ProfileSide> = None;
    for row in rows {
        let (id, name, avatar) = row.map_err(|e| e.to_string())?;
        let side = ProfileSide {
            name: name.unwrap_or_default(),
            avatar,
        };
        if id == "her" {
            her = Some(side);
        } else if id == "me" {
            me = Some(side);
        }
    }
    match (her, me) {
        (Some(her), Some(me)) => Ok(Some(ProfilePayload { her, me })),
        _ => Ok(None),
    }
}

pub(crate) fn read_setting_at(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let conn = open_at(dir)?;
    if !table_exists(&conn, "setting")? {
        return Ok(None);
    }
    conn.query_row("SELECT v FROM setting WHERE k = ?1", params![key], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

pub(crate) fn write_setting_at(dir: &Path, key: &str, value: &str) -> Result<(), String> {
    let conn = open_at(dir)?;
    if !table_exists(&conn, "setting")? {
        return Err("数据库尚未初始化".to_string());
    }
    conn.execute(
        "INSERT OR REPLACE INTO setting(k, v) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn messages_load_at(dir: &Path, limit: usize) -> Result<Vec<ImportMessage>, String> {
    let conn = open_at(dir)?;
    if !table_exists(&conn, "message")? {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 200_000) as i64;
    let mut statement = conn
        .prepare(
            "SELECT id, conv_id, ts, sender, type, content, media_path, reply_to,
                    latency_s, burst_index, burst_size, is_holdout
             FROM message ORDER BY ts ASC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![limit], |row| {
            Ok(ImportMessage {
                id: row.get(0)?,
                conv_id: row.get(1)?,
                ts: row.get(2)?,
                sender: row.get(3)?,
                msg_type: row.get(4)?,
                content: row.get(5)?,
                media_path: row.get(6)?,
                reply_to: row.get(7)?,
                latency_s: row.get(8)?,
                burst_index: row.get(9)?,
                burst_size: row.get(10)?,
                is_holdout: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn persist_media_at(dir: &Path, files: &[MediaPersistItem]) -> Result<i64, String> {
    if files.is_empty() {
        return Ok(0);
    }
    let mut conn = open_at(dir)?;
    if !table_exists(&conn, "media")? {
        return Ok(0);
    }
    let now = now_ms();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut inserted = 0i64;
    for (index, file) in files.iter().enumerate() {
        let ext = Path::new(&file.path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "m4a" => "audio/mp4",
            "ogg" | "opus" => "audio/ogg",
            _ => "image/jpeg",
        };
        let id = format!("media_{now}_{index}");
        tx.execute(
            "INSERT OR REPLACE INTO media(id, persona_id, msg_id, kind, path, mime, bytes, duration_ms, created_at)
             VALUES (?1, 'persona_default', NULL, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![id, file.kind, file.path, mime, file.size, now],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

// ───────────────────────── Tauri commands ─────────────────────────

#[tauri::command]
pub fn db_init(app: tauri::AppHandle, ddl: String) -> DbInitResult {
    let dir = match app_dir(&app) {
        Ok(dir) => dir,
        Err(err) => {
            return DbInitResult {
                ok: false,
                db_path: String::new(),
                message_count: 0,
                error: Some(err),
            }
        }
    };
    let result = (|| -> Result<DbInitResult, String> {
        let conn = open_at(&dir)?;
        conn.execute_batch(&ddl).map_err(|e| format!("apply ddl: {e}"))?;
        let stats = stats_for(&conn, &dir)?;
        Ok(DbInitResult {
            ok: true,
            db_path: stats.db_path,
            message_count: stats.message_count,
            error: None,
        })
    })();
    result.unwrap_or_else(|err| DbInitResult {
        ok: false,
        db_path: dir.join(DB_FILE).display().to_string(),
        message_count: 0,
        error: Some(err),
    })
}

#[tauri::command]
pub fn db_stats(app: tauri::AppHandle) -> Result<DbStats, String> {
    let dir = app_dir(&app)?;
    let conn = open_at(&dir)?;
    stats_for(&conn, &dir)
}

#[tauri::command]
pub fn import_persist(app: tauri::AppHandle, payload: ImportPayload) -> Result<PersistResult, String> {
    let dir = app_dir(&app)?;
    persist_payload_at(&dir, &payload)
}

#[tauri::command]
pub fn profile_save(app: tauri::AppHandle, profile: ProfilePayload) -> Result<bool, String> {
    let dir = app_dir(&app)?;
    profile_save_at(&dir, &profile)?;
    Ok(true)
}

#[tauri::command]
pub fn profile_load(app: tauri::AppHandle) -> Result<Option<ProfilePayload>, String> {
    let dir = app_dir(&app)?;
    profile_load_at(&dir)
}

#[tauri::command]
pub fn media_persist(app: tauri::AppHandle, files: Vec<MediaPersistItem>) -> Result<MediaPersistResult, String> {
    let dir = app_dir(&app)?;
    let inserted = persist_media_at(&dir, &files)?;
    Ok(MediaPersistResult {
        ok: true,
        inserted,
        message: format!("已记录 {inserted} 个素材"),
    })
}

#[tauri::command]
pub fn setting_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let dir = app_dir(&app)?;
    read_setting_at(&dir, &key)
}

#[tauri::command]
pub fn setting_set(app: tauri::AppHandle, key: String, value: String) -> Result<bool, String> {
    let dir = app_dir(&app)?;
    write_setting_at(&dir, &key, &value)?;
    Ok(true)
}

#[tauri::command]
pub fn persona_save(app: tauri::AppHandle, persona: serde_json::Value) -> Result<bool, String> {
    let dir = app_dir(&app)?;
    let json = serde_json::to_string(&persona).map_err(|e| e.to_string())?;
    write_setting_at(&dir, "persona.profile", &json)?;
    Ok(true)
}

#[tauri::command]
pub fn persona_load(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let dir = app_dir(&app)?;
    let Some(raw) = read_setting_at(&dir, "persona.profile")? else {
        return Ok(None);
    };
    serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHit {
    pub id: String,
    pub text: String,
    pub ts: i64,
    pub importance: f64,
    pub valence: Option<f64>,
    pub score: f64,
}

fn memory_rebuild_at(dir: &Path) -> Result<i64, String> {
    let mut conn = open_at(dir)?;
    if !table_exists(&conn, "memory")? {
        return Err("数据库尚未初始化".to_string());
    }
    let rows: Vec<(String, String, String, i64)> = {
        let mut statement = conn
            .prepare(
                "SELECT id, sender, content, ts FROM message
                 WHERE is_holdout = 0 AND type = 'text' AND length(content) >= 2
                 ORDER BY ts ASC LIMIT 20000",
            )
            .map_err(|e| e.to_string())?;
        let mapped = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in mapped {
            out.push(row.map_err(|e| e.to_string())?);
        }
        out
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM memory WHERE persona_id = 'persona_default'", [])
        .map_err(|e| e.to_string())?;
    let mut inserted = 0i64;
    for (id, sender, content, ts) in rows {
        let text = if sender == "her" {
            content
        } else {
            format!("我：{content}")
        };
        let importance = (0.4 + (text.chars().count() as f64) / 200.0).min(0.95);
        tx.execute(
            "INSERT OR REPLACE INTO memory(
                id, persona_id, episode_id, text, emotion_valence, emotion_tag,
                importance, last_access_ts, access_count
             ) VALUES (?1, 'persona_default', NULL, ?2, NULL, NULL, ?3, ?4, 0)",
            params![format!("mem_{id}"), text, importance, ts],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

fn memory_search_at(dir: &Path, query: &str, limit: usize) -> Result<Vec<MemoryHit>, String> {
    let conn = open_at(dir)?;
    if !table_exists(&conn, "memory")? {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 50) as i64;
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    // trigram FTS5 对 <3 字符的查询无结果，短查询走 LIKE
    if q.chars().count() >= 3 {
        let fts_query = format!("\"{}\"", q.replace('"', "\"\""));
        let result = (|| -> Result<Vec<MemoryHit>, rusqlite::Error> {
            let mut statement = conn.prepare(
                "SELECT m.id, m.text, m.last_access_ts, m.importance, m.emotion_valence,
                        bm25(memory_fts) AS rank
                 FROM memory_fts
                 JOIN memory m ON m.rowid = memory_fts.rowid
                 WHERE memory_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
            )?;
            let rows = statement.query_map(params![fts_query, limit], |row| {
                Ok(MemoryHit {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    ts: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    importance: row.get::<_, Option<f64>>(3)?.unwrap_or(0.5),
                    valence: row.get(4)?,
                    score: -row.get::<_, f64>(5)?,
                })
            })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            Ok(out)
        })();
        if let Ok(hits) = result {
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
    }

    let pattern = format!("%{q}%");
    let mut statement = conn
        .prepare(
            "SELECT id, text, last_access_ts, importance, emotion_valence
             FROM memory WHERE text LIKE ?1
             ORDER BY importance DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![pattern, limit], |row| {
            Ok(MemoryHit {
                id: row.get(0)?,
                text: row.get(1)?,
                ts: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                importance: row.get::<_, Option<f64>>(3)?.unwrap_or(0.5),
                valence: row.get(4)?,
                score: 0.5,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn memory_count_at(dir: &Path) -> Result<i64, String> {
    let conn = open_at(dir)?;
    if !table_exists(&conn, "memory")? {
        return Ok(0);
    }
    conn.query_row("SELECT count(*) FROM memory", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_rebuild(app: tauri::AppHandle) -> Result<i64, String> {
    let dir = app_dir(&app)?;
    memory_rebuild_at(&dir)
}

#[tauri::command]
pub fn memory_search(app: tauri::AppHandle, query: String, limit: Option<usize>) -> Result<Vec<MemoryHit>, String> {
    let dir = app_dir(&app)?;
    memory_search_at(&dir, &query, limit.unwrap_or(20))
}

#[tauri::command]
pub fn memory_count(app: tauri::AppHandle) -> Result<i64, String> {
    let dir = app_dir(&app)?;
    memory_count_at(&dir)
}

#[tauri::command]
pub fn messages_load(app: tauri::AppHandle, limit: Option<usize>) -> Result<Vec<ImportMessage>, String> {
    let dir = app_dir(&app)?;
    messages_load_at(&dir, limit.unwrap_or(50_000))
}

#[tauri::command]
pub async fn pick_import_files(app: tauri::AppHandle) -> Result<PickImportResult, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择聊天记录导出文件（txt / csv / json）")
        .add_filter("聊天记录", &["txt", "csv", "json"])
        .pick_files(move |paths| {
            let _ = tx.send(paths);
        });
    let picked = rx.await.map_err(|e| format!("dialog: {e}"))?;
    let Some(paths) = picked else {
        return Ok(PickImportResult {
            ok: false,
            files: Vec::new(),
            message: "未选择文件".to_string(),
        });
    };

    let mut files: Vec<PickedImportFile> = Vec::new();
    let mut skipped = 0usize;
    for path in paths.into_iter().take(MAX_IMPORT_FILES) {
        let source = match path.into_path() {
            Ok(path) => path,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let meta = match fs::metadata(&source) {
            Ok(meta) => meta,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if meta.len() == 0 || meta.len() > MAX_IMPORT_FILE_BYTES {
            skipped += 1;
            continue;
        }
        let bytes = match fs::read(&source) {
            Ok(bytes) => bytes,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let text = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            String::from_utf8_lossy(&bytes[3..]).into_owned()
        } else {
            match String::from_utf8(bytes.clone()) {
                Ok(text) => text,
                Err(_) => {
                    let (decoded, _, _) = GB18030.decode(&bytes);
                    decoded.into_owned()
                }
            }
        };
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("聊天记录")
            .to_string();
        files.push(PickedImportFile {
            name,
            path: source.display().to_string(),
            text,
            size: meta.len(),
        });
    }

    let ok = !files.is_empty();
    let message = if ok {
        format!("已读取 {} 个文件", files.len())
    } else {
        "没有可读取的文件".to_string()
    };
    if skipped > 0 && ok {
        return Ok(PickImportResult {
            ok,
            files,
            message: format!("{message}，跳过 {skipped} 个文件（过大或不可读）"),
        });
    }
    Ok(PickImportResult { ok, files, message })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_DDL: &str = "
        CREATE TABLE IF NOT EXISTS persona(id TEXT PRIMARY KEY, name TEXT, created_at INTEGER, status TEXT);
        CREATE TABLE IF NOT EXISTS message(
          id TEXT PRIMARY KEY, persona_id TEXT, conv_id TEXT, ts INTEGER, sender TEXT, type TEXT,
          content TEXT, media_path TEXT, reply_to TEXT, latency_s INTEGER, burst_index INTEGER,
          burst_size INTEGER, is_holdout INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ingest_job(
          id TEXT PRIMARY KEY, file_name TEXT, status TEXT, stage TEXT, processed INTEGER,
          total INTEGER, created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS setting(k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS profile(
          id TEXT PRIMARY KEY, display_name TEXT, avatar_path TEXT, updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS media(
          id TEXT PRIMARY KEY, persona_id TEXT, msg_id TEXT, kind TEXT, path TEXT, mime TEXT,
          bytes INTEGER, duration_ms INTEGER, created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS memory(
          id TEXT PRIMARY KEY, persona_id TEXT, episode_id TEXT, text TEXT,
          emotion_valence REAL, emotion_tag TEXT, importance REAL,
          last_access_ts INTEGER, access_count INTEGER
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          text, content='memory', content_rowid='rowid', tokenize='trigram'
        );
    ";

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("changzai-store-{name}-{}", std::process::id()))
    }

    fn sample_payload() -> ImportPayload {
        ImportPayload {
            source_names: vec!["wechat.txt".to_string(), "liuhen.json".to_string()],
            messages: (0..10)
                .map(|index| ImportMessage {
                    id: format!("m_{index}"),
                    conv_id: "conv_default".to_string(),
                    ts: 1_684_598_400_000 + index * 60_000,
                    sender: if index % 2 == 0 { "her" } else { "me" }.to_string(),
                    msg_type: "text".to_string(),
                    content: format!("第 {index} 条"),
                    media_path: None,
                    reply_to: None,
                    latency_s: Some(5),
                    burst_index: 1,
                    burst_size: 1,
                    is_holdout: if index == 0 { 1 } else { 0 },
                })
                .collect(),
            report: serde_json::json!({"fidelity_estimate": 61, "fidelity_level": "medium"}),
        }
    }

    #[test]
    fn init_persist_stats_and_profile_roundtrip() {
        let dir = temp_dir("db");
        let _ = fs::remove_dir_all(&dir);
        let conn = open_at(&dir).expect("open db");
        conn.execute_batch(TEST_DDL).expect("ddl");
        assert!(table_exists(&conn, "message").expect("table check"));
        drop(conn);

        let payload = sample_payload();
        let persisted = persist_payload_at(&dir, &payload).expect("persist");
        assert!(persisted.ok);
        assert_eq!(persisted.inserted, 10);
        assert_eq!(persisted.holdout, 1);
        assert_eq!(persisted.message_count, 10);

        let conn = open_at(&dir).expect("reopen");
        let stats = stats_for(&conn, &dir).expect("stats");
        assert_eq!(stats.message_count, 10);
        assert_eq!(stats.her_count, 5);
        assert_eq!(stats.holdout_count, 1);
        assert!(stats.last_import_at.is_some());

        let profile = ProfilePayload {
            her: ProfileSide {
                name: "ta".to_string(),
                avatar: Some("data:image/png;base64,AAAA".to_string()),
            },
            me: ProfileSide {
                name: "我".to_string(),
                avatar: None,
            },
        };
        profile_save_at(&dir, &profile).expect("save profile");
        let loaded = profile_load_at(&dir).expect("load profile").expect("profile exists");
        assert_eq!(loaded.her.name, "ta");
        assert_eq!(loaded.me.name, "我");

        let media = persist_media_at(
            &dir,
            &[MediaPersistItem {
                name: "a.png".to_string(),
                path: "C:/media/a.png".to_string(),
                size: 123,
                kind: "image".to_string(),
            }],
        )
        .expect("media");
        assert_eq!(media, 1);

        // Step 3：setting / persona / messages_load
        write_setting_at(&dir, "llm.config", "{\"model\":\"test\"}").expect("setting write");
        assert_eq!(
            read_setting_at(&dir, "llm.config").expect("setting read"),
            Some("{\"model\":\"test\"}".to_string())
        );
        write_setting_at(&dir, "persona.profile", "{\"version\":1}").expect("persona write");
        assert_eq!(
            read_setting_at(&dir, "persona.profile").expect("persona read"),
            Some("{\"version\":1}".to_string())
        );
        let loaded_messages = messages_load_at(&dir, 100).expect("messages load");
        assert_eq!(loaded_messages.len(), 10);
        assert_eq!(loaded_messages[0].id, "m_0");

        // Step 4：记忆重建 / FTS5 检索
        let rebuilt = memory_rebuild_at(&dir).expect("memory rebuild");
        assert_eq!(rebuilt, 9); // holdout 消息不进入记忆
        assert_eq!(memory_count_at(&dir).expect("memory count"), 9);
        let hits = memory_search_at(&dir, "第", 5).expect("memory search");
        assert!(!hits.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_without_init_returns_error() {
        let dir = temp_dir("noinit");
        let _ = fs::remove_dir_all(&dir);
        let payload = sample_payload();
        let err = persist_payload_at(&dir, &payload).expect_err("should fail");
        assert!(err.contains("数据库尚未初始化"));
        let _ = fs::remove_dir_all(&dir);
    }
}
