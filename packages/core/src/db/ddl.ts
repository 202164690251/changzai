// 常在 · SQLite / SQLCipher DDL v2（02 §3.2 + Step 1/2 增补）
// 说明：
//  1) 实际建库由 Rust 侧执行：PRAGMA key 后再执行本 DDL；
//  2) FTS5 必须用 trigram 分词（默认 unicode61 对中文几乎无效），并配 external-content 同步触发器；
//  3) 所有 SQL 带 IF NOT EXISTS，迁移脚本按 user_version 逐步执行。

export const SCHEMA_VERSION = 2;

export const DDL_V2 = `
-- 元信息
CREATE TABLE IF NOT EXISTS schema_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_meta(k, v) VALUES ('schema_version', '2');

-- 会话与角色
CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY,
  name TEXT,
  slug TEXT,
  created_at INTEGER,
  status TEXT DEFAULT 'active',            -- active | archived
  avatar_path TEXT,                        -- 她的头像（本地文件）；NULL = 默认头像
  style_card_json TEXT,
  persona_graph_json TEXT,
  baseline_json TEXT,
  fidelity_score REAL,
  version INTEGER DEFAULT 1
);

-- 双方资料（我的昵称/头像；她的一侧复用 persona.name/avatar_path）
CREATE TABLE IF NOT EXISTS profile (
  id TEXT PRIMARY KEY,                     -- me | her
  display_name TEXT,
  avatar_path TEXT,
  updated_at INTEGER
);

-- 消息（原样保留，永不修改；recalled=1 不参与上下文与记忆）
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  conv_id TEXT,
  ts INTEGER,
  sender TEXT,
  type TEXT,
  content TEXT,
  media_path TEXT,
  reply_to TEXT,
  latency_s INTEGER,
  burst_index INTEGER,
  burst_size INTEGER,
  episode_id TEXT,
  emotion_json TEXT,
  recalled INTEGER DEFAULT 0,
  attempt INTEGER DEFAULT 1,
  is_holdout INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_ts ON message(persona_id, ts);
CREATE INDEX IF NOT EXISTS idx_msg_ep ON message(episode_id);
CREATE INDEX IF NOT EXISTS idx_msg_holdout ON message(is_holdout);

-- 媒体资产（图片/语音/文件；Step 2 按 msg_id 关联）
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  msg_id TEXT,
  kind TEXT,              -- image | voice | file
  path TEXT,              -- 本地文件路径（绝对或相对数据目录）
  mime TEXT,
  bytes INTEGER,
  duration_ms INTEGER,    -- 语音时长
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_media_msg ON media(msg_id);
CREATE INDEX IF NOT EXISTS idx_media_persona ON media(persona_id);

-- 情节（一次情绪事件，检索与弧线的基本单位）
CREATE TABLE IF NOT EXISTS episode (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  start_ts INTEGER,
  end_ts INTEGER,
  msg_count INTEGER,
  topic TEXT,
  emotion_arc_json TEXT,
  summary TEXT,
  key_quote TEXT,
  importance REAL DEFAULT 0.5
);

-- 事实卡（Fact Lock 的对象；kind 含 relationship，并支持 suspended 状态）
CREATE TABLE IF NOT EXISTS fact (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  kind TEXT,          -- person | place | date | habit | event | preference | relationship
  subject TEXT,
  value TEXT,
  confidence REAL,
  evidence_msg_ids TEXT,
  locked INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active'   -- active | suspended
);

-- 长期记忆片段 + FTS5(trigram) external-content
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  episode_id TEXT,
  text TEXT,
  emotion_valence REAL,
  emotion_tag TEXT,
  importance REAL,
  last_access_ts INTEGER,
  access_count INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  text,
  content='memory',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- 情绪状态（每 persona 一行）
CREATE TABLE IF NOT EXISTS emotion_state (
  persona_id TEXT PRIMARY KEY,
  valence REAL,
  arousal REAL,
  closeness REAL,
  defensiveness REAL,
  weather TEXT,
  tension REAL,
  updated_at INTEGER
);

-- 未闭合话题
CREATE TABLE IF NOT EXISTS open_loop (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  created_ts INTEGER,
  last_ts INTEGER,
  content TEXT,
  source_msg_id TEXT,
  status TEXT DEFAULT 'open',   -- open | resolved | expired
  remind_count INTEGER DEFAULT 0
);

-- 主动消息队列
CREATE TABLE IF NOT EXISTS active_queue (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  fire_at INTEGER,
  desire REAL,
  opportunity REAL,
  score REAL,
  reason TEXT,
  draft TEXT,
  status TEXT DEFAULT 'pending'  -- pending | sent | skipped | cancelled
);

-- 模型配置（key 不落库，只存引用）
CREATE TABLE IF NOT EXISTS model_config (
  id TEXT PRIMARY KEY,
  role TEXT,        -- main | fast | embedding | rerank | tts
  provider TEXT,
  base_url TEXT,
  model TEXT,
  key_ref TEXT,
  params_json TEXT,
  enabled INTEGER DEFAULT 1
);

-- 反馈
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  msg_id TEXT,
  kind TEXT,      -- wrong_style | wrong_fact | too_ai | good | regenerate | recalled
  note TEXT,
  ts INTEGER
);

-- 用户纠正层（F04；改完下一轮生效，可回滚）
CREATE TABLE IF NOT EXISTS correction (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  target TEXT,        -- style | fact | pair | prompt
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  note TEXT,
  created_at INTEGER,
  active INTEGER DEFAULT 1
);

-- 导入作业（长任务续跑；断电/关窗后可恢复）
CREATE TABLE IF NOT EXISTS ingest_job (
  id TEXT PRIMARY KEY,
  file_name TEXT,
  status TEXT DEFAULT 'pending',  -- pending | running | done | failed | cancelled
  stage TEXT,
  processed INTEGER DEFAULT 0,
  total INTEGER,
  error TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- 设置
CREATE TABLE IF NOT EXISTS setting (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- 当前聊天会话（持久化，供重启后恢复上下文；payload 存 ChatMsg JSON）
CREATE TABLE IF NOT EXISTS chat_message (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_message(ts);
`;



export const PRAGMA_AFTER_KEY = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;


`;
