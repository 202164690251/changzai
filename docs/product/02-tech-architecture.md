# 02 · 技术架构与实施说明（Agent 可执行版）

> 项目代号：**常在（Still Here）** ｜ 版本：v1.1
> **本文档的用途**：直接交付给 AI Agent 或工程团队作为开发依据。所有模块均给出数据结构、算法、接口与验收标准，按第 14 章任务卡顺序执行即可产出 MVP。
> **MVP 范围冻结**：文字聊天 + 人格蒸馏 + 情绪引擎 + 记忆 + 主动消息 + 仿微信 UI + 多模型 API 接入 + **Windows / macOS / iOS / Android 四端同时交付**。
> **不在 MVP 内**：本地模型推理、语音克隆、微信/QQ 接入、云同步、账号系统、任何内购。**产品无服务端。**

---

## 1. 技术选型

> **架构基线（v1.1 重大变更）**：不做本地模型推理，全部走用户 API；PC 与移动端**同时交付**。
> 因此**取消 Python sidecar，全栈 TypeScript**——核心逻辑（导入、蒸馏、情绪引擎、记忆、调度）做成纯 TS 包，在四端同一套代码里运行。这是"双端同时 + 纯 API"约束下的唯一合理解。

| 层 | 选型 | 理由 |
|---|---|---|
| **统一壳** | **Tauri 2**（Windows / macOS / iOS / Android 四端同一代码库） | 一份 Web 产物 + 一个 Rust 宿主；免 sidecar；体积 <15MB |
| 前端 | **React 19 + Vite + TypeScript + Tailwind CSS** | 生态成熟，聊天虚拟列表方案多 |
| 状态 | Zustand + TanStack Query | 轻量，适合流式 |
| **核心逻辑** | **`packages/core` 纯 TS**（无 DOM、无 Node API） | 四端复用；可单测；可被 CLI 调用 |
| 宿主能力 | Rust commands（DB / 文件 / Keychain / 通知 / HTTP） | Tauri 2 官方插件 + 少量自研命令 |
| 网络 | **Tauri HTTP 插件**（Rust 侧发请求） | 绕过 WebView CORS，可直连任意 API |
| 数据库 | **SQLite + SQLCipher**（`rusqlite` bundled-sqlcipher） | 单文件加密，四端一致 |
| 检索 | **SQLite FTS5（BM25）+ 情绪/时间加权 + LLM 重排** | 零外部依赖；向量检索降为 P1（需 embedding key） |
| 生成模型 | 用户自带 key，统一走 **OpenAI-Compatible** 适配 | 覆盖 DeepSeek / Qwen / Kimi / GLM / OpenRouter / SiliconFlow / 自定义端点 |
| 调度 | 前端进程内定时器 + 系统本地通知 | 主动消息：预生成 + 定时本地通知 |
| 打包 | pnpm monorepo + Turbo | 四端同仓 |

**不引入**：Docker、K8s、Redis、Postgres、Python 运行时、本地模型、任何服务端。

**为什么砍掉 Python**：移动端跑 Python 需要 Chaquopy/Briefcase 之类的重型方案，包体 +30MB、启动 +2s、调试链路断裂。而 MVP 的全部算法（正则解析、统计、状态机、检索拼装）在 TS 里都是**普通字符串与数值运算**，没有必须用 Python 的理由。唯一损失是"sherpa/ONNX 本地推理"，而这条路已被"纯 API"决策排除。

> **伪代码约定**：本文第 4–10 章的算法块使用 Python 风格书写，**仅为可读性**。实际实现语言为 **TypeScript**；所有跨模块接口以第 11 章 `CoreAPI` 为准。Agent 实现时请直接翻译为 TS，不要引入 Python 运行时。

---

## 2. 仓库结构

```
changzai/
├── apps/
│   └── app/                        # 唯一应用：React + Tauri 2（四端构建）
│       ├── src/                    # React 界面
│       ├── src-tauri/              # Rust 宿主
│       │   ├── src/commands/       # db / fs / keychain / notify / http
│       │   ├── Cargo.toml          # rusqlite(bundled-sqlcipher)
│       │   └── tauri.conf.json     # 四端配置
│       └── vite.config.ts
├── packages/
│   ├── core/                       # 纯 TS 核心（四端共用，可单测）
│   │   ├── ingest/                 # 导入适配器
│   │   ├── distill/                # 人格蒸馏
│   │   ├── emotion/                # 情绪引擎
│   │   ├── runtime/                # 对话运行时
│   │   ├── memory/                 # 记忆系统
│   │   ├── active/                 # 主动消息
│   │   ├── llm/                    # 模型适配层
│   │   └── db/                     # 仓储接口（由宿主实现）
│   └── shared/                     # 类型与常量（前后端共用）
├── prompts/                        # 全部 Prompt 模板（可热更）
├── data/                           # 运行时数据（各端用户目录，gitignored）
└── docs/
```

**依赖方向（强制）**：`app → core → shared`。`core` 内**禁止**出现 `window`、`fs`、`fetch`、`localStorage`——所有外部能力通过注入的接口（`DbPort` / `HttpPort` / `ClockPort` / `NotifyPort`）访问，保证可测试、可移植。

---

## 3. 数据模型

### 3.1 归一化消息 Schema（JSONL，导入中间格式）

```json
{
  "msg_id": "wx_20230520_0001",
  "conv_id": "conv_001",
  "ts": 1684598400000,
  "sender": "her",              // "her" | "me" | "system"
  "sender_name": "小林",
  "type": "text",               // text | image | voice | video | emoji | quote | file | redpacket | call | system
  "content": "在干嘛",
  "media_path": null,           // 相对路径，媒体专用
  "media_duration": null,       // 语音秒数
  "reply_to": null,             // msg_id
  "latency_s": 137,             // 距上一条对方消息的秒数
  "burst_index": 1,             // 本轮连发的第几条
  "burst_size": 3,              // 本轮连发总数
  "raw_type": 1                 // 原始类型码，便于溯源
}
```

**硬性要求**：`latency_s` / `reply_to` / `burst_index` **不得为空**，这是行为引擎的原料。缺失时由 ingest 阶段推算补全（见 4.3）。

### 3.2 SQLite DDL（核心表）

```sql
-- 会话与角色
CREATE TABLE persona (
  id TEXT PRIMARY KEY, name TEXT, slug TEXT, created_at INTEGER,
  status TEXT DEFAULT 'active',            -- active | archived
  style_card_json TEXT,                    -- 见 5.3
  persona_graph_json TEXT,                 -- 见 5.4
  baseline_json TEXT,                      -- 情绪基线
  fidelity_score REAL,                     -- 0-100
  version INTEGER DEFAULT 1
);

-- 消息（原样保留，永不修改）
CREATE TABLE message (
  id TEXT PRIMARY KEY, persona_id TEXT, conv_id TEXT,
  ts INTEGER, sender TEXT, type TEXT, content TEXT,
  media_path TEXT, reply_to TEXT, latency_s INTEGER,
  burst_index INTEGER, burst_size INTEGER,
  episode_id TEXT, emotion_json TEXT,      -- 标注结果
  recalled INTEGER DEFAULT 0,              -- 1 = 已撤回，不参与上下文与记忆
  attempt INTEGER DEFAULT 1,               -- 重发次数
  is_holdout INTEGER DEFAULT 0
);
CREATE INDEX idx_msg_ts ON message(persona_id, ts);
CREATE INDEX idx_msg_ep ON message(episode_id);

-- 情节（一次情绪事件，检索与弧线的基本单位）
CREATE TABLE episode (
  id TEXT PRIMARY KEY, persona_id TEXT,
  start_ts INTEGER, end_ts INTEGER, msg_count INTEGER,
  topic TEXT, emotion_arc_json TEXT, summary TEXT,
  key_quote TEXT, importance REAL DEFAULT 0.5
);

-- 事实卡（Fact Lock 的对象）
CREATE TABLE fact (
  id TEXT PRIMARY KEY, persona_id TEXT,
  kind TEXT,          -- person | place | date | habit | event | preference
  subject TEXT, value TEXT, confidence REAL,
  evidence_msg_ids TEXT,   -- JSON 数组
  locked INTEGER DEFAULT 1
);

-- 长期记忆片段
CREATE TABLE memory (
  id TEXT PRIMARY KEY, persona_id TEXT, episode_id TEXT,
  text TEXT, emotion_valence REAL, emotion_tag TEXT,
  importance REAL, last_access_ts INTEGER, access_count INTEGER
);
CREATE VIRTUAL TABLE memory_fts USING fts5(text, content='memory', content_rowid='rowid');

-- 情绪状态（每 persona 一行，随时间更新）
CREATE TABLE emotion_state (
  persona_id TEXT PRIMARY KEY,
  valence REAL, arousal REAL, closeness REAL, defensiveness REAL,
  weather TEXT, tension REAL, updated_at INTEGER
);

-- 未闭合话题
CREATE TABLE open_loop (
  id TEXT PRIMARY KEY, persona_id TEXT,
  created_ts INTEGER, last_ts INTEGER,
  content TEXT, source_msg_id TEXT,
  status TEXT DEFAULT 'open',   -- open | resolved | expired
  remind_count INTEGER DEFAULT 0
);

-- 主动消息队列
CREATE TABLE active_queue (
  id TEXT PRIMARY KEY, persona_id TEXT,
  fire_at INTEGER, desire REAL, opportunity REAL, score REAL,
  reason TEXT, draft TEXT, status TEXT DEFAULT 'pending'  -- pending | sent | skipped | cancelled
);

-- 模型配置（key 不落库，见 12.4）
CREATE TABLE model_config (
  id TEXT PRIMARY KEY, role TEXT,        -- main | fast | embedding | rerank | tts
  provider TEXT, base_url TEXT, model TEXT,
  key_ref TEXT,                          -- Keychain 引用
  params_json TEXT, enabled INTEGER DEFAULT 1
);

-- 反馈（在线学习的原料）
CREATE TABLE feedback (
  id TEXT PRIMARY KEY, persona_id TEXT, msg_id TEXT,
  kind TEXT,      -- wrong_style | wrong_fact | too_ai | good | regenerate
  note TEXT, ts INTEGER
);

-- 设置
CREATE TABLE setting (k TEXT PRIMARY KEY, v TEXT);
```

### 3.3 文件布局

```
data/
├── changzai.db              # SQLCipher
├── media/{persona_id}/      # 解密后的图片/语音
├── exports/                 # 用户主动导出
└── logs/                    # 脱敏日志，7 天轮转
```

---

## 4. M1 · 数据导入

### 4.1 适配器接口（插件式）

```python
class BaseAdapter(ABC):
    name: str
    def sniff(self, path: Path) -> float: ...        # 0-1 置信度
    def parse(self, path: Path) -> Iterator[RawMessage]: ...
```

MVP 必须实现：`wechatmsg_txt`、`wechatmsg_csv`、`liuhen_json`、`qq_txt`、`plaintext_paste`。
P1：`wechat_html`、`qq_mht`、`wechat4x_db`（依赖外部解密工具输出）。

### 4.2 解析步骤

1. **编码探测**：`chardet` → 统一 UTF-8。
2. **时间戳正则族**：适配 `YYYY-MM-DD HH:MM:SS`、`YYYY/MM/DD`、`上午/下午`、微信中文日期。
3. **说话人判定**：优先用显式 sender 字段；否则用"消息块缩进/前缀"推断；最后用 **LLM 兜底**（仅在样本 <5% 时启用）。
4. **系统消息剔除**：`[图片]`、`撤回`、红包、转账、语音通话等，单独打 type，不参与人格训练但与"事件"相关（如语音通话 30 分钟）。
5. **连发识别**：同一 sender 相邻间隔 < 90s 记为同一 burst，计算 `burst_index/size`。
6. **延迟计算**：`latency_s = 本条 ts - 上一条对方消息 ts`，上限截断 86400。
7. **去重**：`hash(conv_id + ts + sender + content)`。

### 4.3 媒体资产（P1，但 MVP 预留字段）

微信 4.x 媒体链路（外部工具完成，产品只负责 ingest）：

| 类型 | 存储 | 处理 |
|---|---|---|
| 图片 | `.dat`（XOR / V1 / V2 三种加密） | 外部工具解密为 jpg/png，放入 `media/`，按 `msg_id` 关联 |
| 语音 | SILK v3 | 外部转 wav/mp3（ffmpeg），并可用 Whisper 转文字存 `content` |
| 表情包 | gif/png | 直接入库，UI 支持内联 |
| 视频 | 加密 mp4 | P2 |

> **现实约束（写进产品文案）**：微信会自动清理过期媒体，**已过期的图片/语音任何工具都导不出**。导入向导必须明确提示"先在仍保留数据的设备上导出"。

### 4.4 数据体检报告（必须实现）

```python
report = {
  "total_msgs": 47090, "her_msgs": 17923, "span_days": 1080,
  "night_ratio": 0.31, "avg_len": 11.2, "burst_p50": 2,
  "conflict_episodes": 37, "sweet_episodes": 122,
  "has_voice": True, "has_image": True,
  "fidelity_estimate": 78,        # 0-100
  "fidelity_level": "high",       # low | medium | high
  "missing": ["2023-06 至 2023-09 无记录", "分手前 30 天缺失"],
  "advice": "建议补充深夜对话，最能体现真实性格"
}
```

**fidelity_estimate 算法**（启发式，可调）：

```
score = 40*min(her_msgs/8000,1) + 20*min(span_days/730,1)
      + 15*min(night_ratio/0.3,1) + 15*min(conflict_episodes/20,1)
      + 10*(1 if has_voice else 0)
```

`<45` → 轻度模式（只做 Style Card，不启用情绪引擎的冲突能力）；`45-70` → 标准；`>70` → 高保真。

---

## 5. M2 · 人格蒸馏

### 5.1 流水线

```
message(her) ──► 情绪标注（LLM 批量）──► 校准抽检
      │                                    │
      ├─► Style Card 统计（纯代码）
      ├─► episode 切分 ──► 情境-反应对抽取（LLM）──► 证据链
      └─► fact 抽取（LLM + 规则）──► Fact Lock
                                    │
                          persona_graph + memory + baseline
```

### 5.2 情绪标注 Prompt（`prompts/label_emotion.md`）

输入：连续 20 条消息窗口（保留上下文）。
输出：严格 JSON 数组：

```json
[{"msg_id":"...","valence":-0.4,"arousal":0.6,"closeness":0.7,
  "defensiveness":0.2,"label":"委屈","confidence":0.8}]
```

约束：
- 四轴均 ∈ [-1,1]（closeness/defensiveness ∈ [0,1]）。
- `label` 只能取 24 个枚举值（喜/怒/哀/惧/厌/惊/委屈/撒娇/敷衍/冷淡/试探/吃醋/愧疚/心疼/怀念/调侃/认真/疲惫/兴奋/焦虑/失望/释然/暧昧/平静）。
- 批量 200 条/请求，失败重试 2 次，仍失败则跳过并记录。

**校准**：随机抽 200 条人工标注，计算 Cohen's Kappa；**Kappa < 0.6 不得上线情绪引擎**，需重写 Prompt 或换模型。

### 5.3 Style Card（纯统计，无 LLM）

| 字段 | 计算 |
|---|---|
| `sentence_len_p50/p90` | 按标点/换行切句后取分位 |
| `burst_median/max` | 连发条数分布 |
| `punct_ratio{period,comma,tilde,question,exclaim,ellipsis}` | 计数 / 总句数 |
| `emoji_top/freq` | Unicode emoji 正则统计 |
| `catchphrase[]` | 2-4 gram 中，出现 ≥5 次且 **PMI 高于基线** 的短语 |
| `typo_map` | 常见同音错字对（"在/再"），需人工白名单 |
| `voice_ratio` | 语音条 / 总消息 |
| `night_ratio` | 23:00-02:00 消息占比 |
| `reply_latency` | 对数正态拟合 (μ, σ) |
| `openers[]` | 会话首条消息的高频模式（"在吗""睡了没"） |
| `address_terms[]` | 称呼演变（按时间分段） |

输出为 JSON，**直接作为生成阶段的硬约束**（见 9.5）。

### 5.4 情境-反应对抽取（`prompts/extract_pairs.md`）

对每个 episode，让 LLM 输出：

```json
{
  "situation": "被冷落超过2小时后再收到消息",
  "her_reaction": "不追问，回一个句号或表情包，隔很久才说正事",
  "quote": "。",
  "evidence_msg_ids": ["m_10231","m_10245"],
  "confidence": 0.82,
  "tags": ["回避","试探"]
}
```

**规则**：
- 每条必须有 `quote` 与 `evidence_msg_ids`，**无证据直接丢弃**。
- 每个 persona 产出 30–60 条，按 confidence 排序，取 top 40 注入。
- 冲突的条目**保留**（人本来就矛盾），在注入时用"有时候…有时候…"表述。

### 5.5 事实锁（Fact Lock）

- 抽取 `fact` 表：人物、地点、日期、习惯、事件、偏好。
- 每条带 `evidence_msg_ids` 与 `confidence`；`confidence < 0.6` 不入锁。
- **关系状态特例**：`fact(kind='relationship', value='已分手')` 标记为 `suspended`，即**不主动提及、不否认、不强调**，以"还在"的姿态陪伴；但**不允许被改写为"我们没分手"**。
- 用户试图改写事实时（"其实那天你没走"），走 8.7 的处理流程。

### 5.6 产物

`persona/style_card.json`、`persona/persona_graph.json`、`persona/facts.json`、`persona/memories.jsonl`、`persona/baseline.json`、`persona/report.md`（人类可读摘要，供用户审阅修改）。

---

## 6. M3 · 情绪引擎

### 6.1 状态与更新

状态向量 `s = [valence, arousal, closeness, defensiveness]`，另有 `weather ∈ {sunny, cloudy, overcast, storm, clearing}`、`tension ∈ [0,1]`。

```python
def update(state, appraisal, persona, dt_min):
    # 1) 刺激引起的偏移
    delta = appraisal_to_delta(appraisal)          # 由 LLM 输出的 appraisal 映射
    delta = clip_norm(delta, persona.max_delta)    # 单轮最大变化，默认 0.35

    # 2) 惯性衰减：向基线回归
    baseline = persona.baseline
    decay = 1 - exp(-dt_min / persona.half_life)   # half_life 默认 180 分钟
    s_new = state.s + delta + (baseline - state.s) * decay * 0.3

    # 3) 张力池
    tension = clamp(state.tension + appraisal.tension_delta, 0, 1)
    if tension > persona.storm_threshold:          # 默认 0.72
        weather = "storm"

    return clamp_state(s_new), tension, weather
```

**硬规则**：单轮 `|Δvalence| ≤ 0.35`、`|Δcloseness| ≤ 0.3`。真实的人不会一句话从暴怒到撒娇。

### 6.2 转移矩阵（从数据学）

对每个 persona 统计：

```
P(next_state_bucket | current_bucket, stimulus_type)
state_bucket  = 效价 × 唤醒 的 3×3 网格
stimulus_type = {被夸, 被冷落, 被质问, 被关心, 提到第三方, 吵架, 深夜闲聊, 分享日常}
```

用于：
- 生成前的**合理性校验**（若 LLM 给出的反应概率 < 5%，重采样）。
- 主动消息的**情绪预热**（她今天心情如何，决定发什么）。

### 6.3 表里差（抑制模型）

```python
def express(internal, persona, ctx):
    # 依恋类型决定抑制强度
    suppress = {"secure":0.15, "anxious":0.05, "avoidant":0.45, "fearful":0.35}[persona.attachment]
    # 关系安全度越高，越不藏
    suppress *= (1 - 0.6 * ctx.relationship_safety)
    # 负面情绪更容易被藏（嘴硬）
    if internal.valence < 0:
        suppress += 0.15
    return internal * (1 - clamp(suppress, 0, 0.7))
```

`expressed` 才进入生成 Prompt；`internal` 进入日志供调参。**这个差值就是"嘴硬"的量化。**

### 6.4 张力与爆发

- 每次小失望 `tension += 0.05~0.12`（由 appraisal 给出）。
- `tension > 0.72` → `weather = storm`，允许一次爆发（说重话、消失 1-2 小时）。
- 爆发后 `tension *= 0.4`，进入 `overcast`。
- 连续 3 天 `tension < 0.2` → 回到 `sunny`。

### 6.5 Arc Director（会话级导演）

会话开始时判定场次，并加载预算：

| 场次 | 判定条件 | 温度预算（负面强度上限） | 必做 | 禁做 |
|---|---|---|---|---|
| 日常 | 默认 | 0.3 | 至少一次"记得你说过…" | 连续 3 轮以上高强度 |
| 深夜 | 23:00 后 或 用户出现情绪词 | 0.5 | 结尾降速、变短 | 给建议、讲道理 |
| 回忆 | 用户提及过去/照片 | 0.6 | 一个精确细节 | 过度美化、编造 |
| 和解 | 上轮 weather=storm | 0.8 | 走完"破冰→台阶→和好" | 半途而废 |

**预算耗尽时强制转向**：`if neg_used > budget: force_turn_to_neutral()`。

### 6.6 Comfort Governor（安全阀，三律）

```python
def govern(candidate_reply, state, ctx, persona):
    # 律一：归因
    if candidate_reply.negative and not candidate_reply.attribution:
        return fallback_neutral(persona)          # 无来由的冷 → 直接替换

    # 律二：上限
    vulnerability = estimate_vulnerability(ctx)   # 0-1，见下
    harm = candidate_reply.neg_intensity * vulnerability
    if harm > 0.55:
        candidate_reply = soften(candidate_reply, ratio=0.55/harm)

    # 律三：出口
    if ctx.conflict_turns >= 3 and not ctx.repair_started:
        schedule_repair(persona)                  # 她先递台阶

    return candidate_reply
```

`estimate_vulnerability` 输入信号（加权和，clip 到 [0,1]）：
自伤/绝望词 (+0.3)、凌晨 0-5 点 (+0.15)、连续 3 条负向 (+0.2)、提及分手/前任 (+0.15)、单日使用 >120 分钟 (+0.1)、历史危机标记 (+0.3)。

**不可关闭**。设置页不提供开关。

### 6.7 事实锁处理

| 用户行为 | 她的反应 |
|---|---|
| 试图改写事实（"那天你根本没走"） | 不配合编造，用她的方式挡回去：「你又来了」「我记性没那么差」；随后把话题拉回当下 |
| 试图改变关系状态（"我们没分手对吧"） | **不承认也不否认**，用角色化的模糊回应带过；不主动提"分手"二字 |
| 追问"你是不是 AI" | 不撒谎、不破戏：用她的语气反问或转移（"你今天怎么怪怪的"），但**产品层在气泡上常驻 AI 标识**，不欺骗 |
| 要求 ta 说"我爱你"但数据显示她从不这样说 | **拒绝**（Layer 0 硬规则）：保持沉默、转移话题，或说一句她真会说的话 |

---

## 7. M4 · 对话运行时

### 7.1 五步流水线

```python
async def handle(user_msg, persona, ctx):
    # 1. Appraise
    appraisal = await appraise(user_msg, ctx)      # LLM，小模型即可，JSON 输出

    # 2. Decide
    decision = decide(appraisal, persona, ctx)
    # {"reply": True, "delay_s": 43, "burst": 2, "emoji": False, "voice": False}

    if not decision.reply:
        await schedule_later(user_msg, decision.recheck_at)
        return

    # 3. Compose
    context = memory.assemble(user_msg, persona, appraisal)
    draft = await compose(context, persona, appraisal, decision)   # 流式

    # 4. Filter
    draft = ai_taste_filter(draft, persona.style_card)
    draft = consistency_check(draft, persona, ctx)
    draft = govern(draft, state, ctx, persona)
    draft = safety_filter(draft)

    # 5. Emit
    await emit(draft, decision)   # 按 burst 分段 + 打字延迟
```

### 7.2 Appraise（`prompts/appraise.md`）

输出 JSON：

```json
{"topic":"工作抱怨","emotion":"疲惫","intensity":0.6,
 "relation_signal":"寻求安慰","taboo_hit":false,
 "tension_delta":0.05,"needs_memory":true,"memory_hint":"加班"}
```

### 7.3 Decide（纯规则 + 数据拟合）

```python
def decide(appraisal, persona, ctx):
    p_reply = 0.92 * alertness(ctx) * interest(appraisal, persona)
    if random() > p_reply:
        return Decision(reply=False, recheck_at=now+random_minutes(20,90))

    mu, sigma = persona.style_card.reply_latency
    delay = lognormal(mu, sigma) * busy_factor(ctx) * mood_factor(state)
    delay = clip(delay, 3, 7200)

    burst = sample_from(persona.style_card.burst_dist)
    if appraisal.intensity > 0.7: burst = max(burst, 2)

    return Decision(reply=True, delay_s=delay, burst=burst,
                    emoji=should_emoji(persona, appraisal),
                    voice=should_voice(persona, appraisal))
```

`busy_factor`：她在上班/睡觉 → 2.5~8；空闲 → 0.6。
`mood_factor`：valence 低 → 1.8；arousal 高 → 0.5。

### 7.4 Compose Prompt 结构（`prompts/compose.md`）

```
[System]
{persona_graph.layer0_hard_rules}
{style_card 的硬约束，用自然语言表述}
{当前情绪状态：expressed 值 + weather}
{Arc 预算：本场剩余负面额度}

[Few-shot：检索到的 3-5 组「情境-反应对」原文]
情境：{situation}
她说：{quote}

[Memory：相关记忆 3-6 条，带时间]
2023-05-20 她说：「…」

[对话历史：最近 12 轮]

[User] {user_msg}

[Output Rules]
1. 只输出她会说的话，不要旁白、不要括号动作、不要 emoji 以外的符号
2. 单条 ≤ {p90_len} 字；需要多句时用换行分隔，最多 {burst} 段
3. 绝对禁止：排比、总结、安慰套话（"我理解你""要照顾好自己"）、"作为一个…"、破折号
4. 不要每次都回应全部内容，可以只接一句
5. 如果她不回，输出 <silence>
```

### 7.5 AI 味过滤器（正则 + 规则，硬编码）

| 规则 | 处理 |
|---|---|
| 出现"首先/其次/总之/综上/希望对你有帮助" | 整句删除 |
| 出现"我理解你的感受/抱抱你/你要照顾好自己" | 替换为她的口头禅或删除 |
| 句长 > p90 × 1.5 | 按标点切分或截断 |
| 排比（连续 3 句同结构） | 保留第一句 |
| 破折号 `——` | 替换为逗号或删除 |
| 段落 > burst | 截断并排队为后续消息 |
| 连续 2 条以"其实"开头 | 改写第二条 |
| emoji 数 > style_card 期望 × 2 | 删至期望值 |

### 7.6 Emit（节奏编排）

```python
async def emit(draft, decision):
    parts = split(draft, decision.burst, persona.style_card)
    await typing_indicator(on=True)
    for i, part in enumerate(parts):
        await asyncio.sleep(typing_time(part) * jitter(0.8, 1.3))
        await send(part)
        if i < len(parts) - 1:
            await asyncio.sleep(random(0.6, 2.2))
    await typing_indicator(off=True)
```

`typing_time(text) = 0.35s + 字数 × 0.055s`（中文输入速度约 18 字/分钟？按实际拟人取 3-4 字/秒）。

**已读不回**：`decision.reply=False` 时，UI 显示"已读"但不回，30-90 分钟内可能补一条。

### 7.7 撤回重发

**交互定义**（完全对齐微信语感）：

```
用户长按她的气泡
   → 菜单：复制 / 引用 / 撤回 / 删除
   → 点「撤回」
   → 气泡消失，插入系统提示「对方撤回了一条消息」
   → 2-6 秒后出现「对方正在输入…」
   → 她重新发一条（内容不同，语气一致）
```

**为什么优于"重说"**：`重说` 是工具语言，把用户拉出戏；`撤回` 是社交语言，把用户留在戏里，还顺带制造了一次"她在重新想怎么说"的真实感。

**实现约束**：

```ts
async function recallLast(convId: string) {
  const last = await db.lastAssistantMessage(convId);
  if (!last || within(3_000)) throw new Error('TOO_SOON');     // 3 秒内不许撤回

  await db.markRecalled(last.id);                              // recalled = 1
  await context.remove(last.id);                               // 从上下文剔除
  await memory.exclude(last.id);                               // 不进入长期记忆
  await feedback.record({ msgId: last.id, kind: 'recalled' }); // 负例

  await ui.systemNotice('对方撤回了一条消息');
  await ui.typing(rand(2000, 6000));

  return compose({
    ...ctx,
    temperature: ctx.temperature + 0.15,
    negative: [last.text],        // 明确"不要重复这句"
    attempt: last.attempt + 1,
  });
}
```

**防滥用**：同一会话 20 条内最多 3 次；每日 10 次；达到上限后菜单项置灰并提示「她今天不想再改口了」。

**她也可能自己撤回**：概率 3%（`persona.recall_rate` 从数据学，若无数据默认 3%），走同一套流程，但不需要用户操作——这会显著提升"真人感"，也是数据里真实存在的行为。

**关键**：被撤回的那条**必须从记忆与上下文中彻底消失**，否则她会"记得自己没说过的话"，这是最容易露馅的地方。

---

## 8. M5 · 记忆系统

### 8.1 四层

| 层 | 内容 | 存储 | 注入 |
|---|---|---|---|
| L0 工作记忆 | 最近 20 轮原文 | 内存 | 全量 |
| L1 情节记忆 | 本场摘要 + 未闭合话题 | `episode` / `open_loop` | 摘要 + 最多 3 个 loop |
| L2 长期记忆 | 原话片段 + 事件 | `memory` + 向量 | top 5 |
| L3 关系状态 | 亲密度/张力/未解决冲突 | `emotion_state` | 结构化描述 |

### 8.2 混合检索

> **检索基座（v1.1）**：默认 **BM25 + 结构化加权 + LLM 重排**，零外部依赖、零额外 key。
> 向量检索是 P1 增强项（需 embedding API），未配置时自动降级为纯 BM25，功能不缺失。

```ts
async function retrieve(query: string, p: Persona, topK = 5): Promise<Memory[]> {
  // 1) 候选召回：FTS5 BM25
  const sparse = await db.ftsSearch(query, 30);

  // 2) 结构化加权（纯代码，离线可用）
  const scored = sparse.map(m => ({
    ...m,
    score: m.bm25
      * (1 + 0.25 * emotionCongruence(m.valence, state.valence))  // 用户难过 → 优先"她安慰过你"的记忆
      * (1 + 0.15 * recencyBoost(m.ts))
      * (1 + 0.20 * m.importance),
  }));

  // 3) 可选：向量召回，配置了 embedding 才启用
  let fused = scored;
  if (cfg.embeddingEnabled) {
    const dense = await db.vecSearch(await embed(query), 20);
    fused = rrf(scored, dense);            // Reciprocal Rank Fusion
  }

  // 4) LLM 重排（用 fast 模型，一次调用，成本极低）
  return await rerankByLLM(query, fused.slice(0, 15)).slice(0, topK);
}
```

`emotionCongruence`：用户难过时优先召回"她安慰过你"的记忆，而不是字面匹配"难过"。**这是本产品记忆系统的核心差异点。**

### 8.3 遗忘曲线

```python
retention = exp(-days_since / (stability * importance))
if retention < 0.25 and importance < 0.6:
    mark_as_faded(memory)     # 不删除，只是不再主动召回
```

**只对次要细节衰减**（`importance < 0.6`）：生日、重大事件、Fact Lock 内容**永不衰减**。
表现层：偶尔"记不清细节"（"那家店叫什么来着"），但情绪与结论保留。**这是拟真，不是 bug。**

### 8.4 未闭合话题

- 检测：她问了一个需要回答的问题、约定、承诺（"周末告诉你"）。
- 状态：`open` → 用户回应则 `resolved`；7 天未回应 → `expired`。
- 用途：主动消息的燃料（"你那个面试怎么样了"），**回复率最高的主动消息类型**。

---

## 9. M6 · 主动消息

### 9.1 欲望 × 机会

```python
def active_score(persona, ctx, now):
    desires = {
      "share":    share_desire(persona, now),      # 今天发生的事
      "followup": open_loop_urgency(persona),      # 未完话头
      "missing":  missing_curve(ctx),              # 多久没聊
      "ritual":   ritual_match(now),               # 早安/晚安/纪念日
      "repair":   repair_need(persona),            # 冲突后
    }
    desire = max(desires.values())

    opportunity = (schedule_free(persona, now)
                   * user_active_prob(ctx, now)
                   * budget_left(persona, now)
                   * (0 if in_dnd(now) else 1))

    return desire * opportunity, max(desires, key=desires.get)
```

`score > 0.55` 且通过 Governor 复核 → 入队，`fire_at = now + random(0, 20min)`。

### 9.2 打扰预算（硬上限）

| 项 | 默认 |
|---|---|
| 每日主动上限 | 3 条 |
| 免打扰 | 23:30–08:00（可配置） |
| 连续未回复 | 2 条后降频至每天 1 条 |
| 3 天未回复 | 暂停主动，等她先开口 |
| 单周上限 | 12 条 |

**禁止**：随机高频、深夜突袭、"你不理我我就多发"。

### 9.3 移动端特殊处理

移动 OS 会杀后台 → **主动消息采用"预生成 + 本地定时通知"**：
每晚 23:00 生成次日 3 条候选（含文案），写入本地通知队列，由系统定时触发；用户点开进入会话。这样即使 App 未运行也能"她来找你"。

---

## 10. M7 · 模型接入层

### 10.1 统一接口

```ts
interface LLMProvider {
  readonly id: string;                     // 'openai-compat' | 'anthropic' | 'gemini'
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  embed?(texts: string[]): Promise<number[][]>;
}

interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}
```

### 10.2 适配器（MVP 必做）

**产品只支持 API Key 模式，不内置任何本地模型运行时。**

| 适配器 | 覆盖 | 备注 |
|---|---|---|
| `OpenAICompat` | DeepSeek、Qwen(DashScope 兼容)、Kimi、GLM、OpenRouter、SiliconFlow、自定义 base_url | **唯一必需适配器** |
| `AnthropicNative` | Claude | 可选，P1 |
| `GeminiNative` | Gemini | 可选，P1 |

预设清单（内置，用户点选即填好 base_url + 默认模型）：
`DeepSeek / 通义千问 / Kimi / 智谱 GLM / OpenRouter / SiliconFlow / 自定义`

> **边界说明**：`自定义 base_url` 允许高级用户填任何 OpenAI 兼容端点（含自建 vLLM）。产品**不内置 Ollama、不提供本地模型引导、不做本地推理**——这是为了让四端行为完全一致、包体可控、支持成本最低。

**MVP 只需 `OpenAICompat` 一个适配器**，即可覆盖 95% 用户。

### 10.3 多模型路由

| 角色 | 用途 | 建议 |
|---|---|---|
| `main` | 对话生成 | 用户主模型（**必须配置**） |
| `fast` | Appraise / 标注 / 摘要 / 重排 | 默认复用 main；用户可单独配更便宜的 |
| `embedding` | 记忆向量检索（P1） | 默认关闭；配置后启用混合检索 |

用户只需配一个 `main` 即可跑通全部功能；`fast` 与 `embedding` 全部自动降级。

### 10.4 Key 安全

- **不落库**：存系统安全存储（Tauri `stronghold` / iOS Keychain / Android Keystore），DB 只存 `key_ref`。
- **不出设备**：请求由 Rust 侧 `reqwest` 直发用户指定 endpoint，不经任何中转。
- 日志脱敏：`sk-****abcd`。
- 导出配置时排除 key；截图/录屏时设置页自动遮蔽 key。
- 卸载 App 时提示"key 仍在系统钥匙串中"，并提供清除入口。

### 10.5 失败处理

| 情况 | 策略 |
|---|---|
| 401/403 | 提示换 key，不重试 |
| 429 | 指数退避 3 次，切备用模型 |
| 5xx | 重试 2 次，切备用模型 |
| 内容拒绝（safety） | 降级话术 + 记录；连续 3 次切备用模型 |
| 超时（>30s） | 中断并提示"她好像没看到" |

---

## 11. 核心服务接口（替代后端 API）

> v1.1 取消 sidecar，界面直接调用 `packages/core`。以下为 `CoreAPI` 的方法签名，**界面层不得绕过它直接操作 DB**。

```ts
export interface CoreAPI {
  // ── 导入 ─────────────────────────────
  importFiles(files: FileRef[], onProgress: (p: Progress) => void): Promise<JobId>
  getImportReport(jobId: JobId): Promise<HealthReport>
  previewPersona(jobId: JobId): Promise<PersonaDraft>       // 人类可读摘要，供用户编辑
  buildPersona(draft: PersonaDraft, onStage: (s: Stage) => void): Promise<PersonaId>

  // ── 人格 ─────────────────────────────
  getPersona(id: PersonaId): Promise<Persona>
  patchPersona(id: PersonaId, patch: PersonaPatch): Promise<void>   // 写入 Correction 层
  listPersonas(): Promise<PersonaMeta[]>
  deletePersona(id: PersonaId): Promise<void>

  // ── 对话 ─────────────────────────────
  send(convId: ConvId, text: string): AsyncIterable<ChatEvent>
  // ChatEvent = {type:'appraisal'} | {type:'typing'} | {type:'chunk',text}
  //           | {type:'part_end'} | {type:'read'} | {type:'done'} | {type:'error',code}
  recallLast(convId: ConvId): Promise<RecalledMessage>      // 撤回她最后一条，并重新生成
  history(convId: ConvId, cursor?: string): Promise<Page<Message>>
  endSession(convId: ConvId): Promise<SessionSummary>

  // ── 情绪 ─────────────────────────────
  getEmotion(personaId: PersonaId): Promise<EmotionState>   // 调试面板用
  getArcPreview(personaId: PersonaId): Promise<ArcPlan>     // 当前场次与剩余预算

  // ── 主动消息 ─────────────────────────
  previewActive(personaId: PersonaId): Promise<ActiveCandidate[]>  // 含 reason，可读
  triggerActive(personaId: PersonaId, id: string): Promise<void>
  scheduleActive(personaId: PersonaId): Promise<void>              // 预生成次日通知

  // ── 模型 ─────────────────────────────
  listProviders(): Promise<ProviderPreset[]>
  upsertModelConfig(cfg: ModelConfig): Promise<void>        // key 写入 Keychain
  testModel(id: string): Promise<TestResult>
  setActiveModel(role: ModelRole, id: string): Promise<void>

  // ── 反馈与数据 ───────────────────────
  feedback(payload: FeedbackInput): Promise<void>
  exportAll(): Promise<ExportBundle>
  destroyAll(): Promise<DestroyReceipt>
}
```

**调试用本地 HTTP（可选，仅开发构建）**：暴露 `/debug/*` 只读端点用于自动化测试，生产构建剔除。不再对外暴露业务 API——**没有服务端，就没有服务端攻击面**。

**流式**：用 `AsyncIterable<ChatEvent>`，界面层按事件驱动打字机与分段，不用 SSE 协议。

---

## 12. M8 · 前端（仿微信聊天框）

### 12.1 组件树

```
App
├── OnboardingWizard
│   ├── StepWelcome      # 三屏说明 + 年龄校验
│   ├── StepImport       # 拖拽/选择/粘贴
│   ├── StepReport       # 数据体检
│   └── StepPersona      # 摘要审阅 + 可编辑
├── ChatShell
│   ├── NavBar           # 备注名 + 在线状态 + 更多
│   ├── MessageList      # 虚拟滚动
│   │   ├── TimeDivider
│   │   ├── TextBubble
│   │   ├── ImageBubble
│   │   ├── VoiceBubble
│   │   └── SystemNotice
│   ├── TypingIndicator  # 三点动画
│   ├── Composer         # 输入 / 按住说话 / 表情
│   └── AICornerBadge    # 常驻 AI 标识
├── DoorsPage            # 三扇门入口
├── ModelSettings
├── PersonaSettings      # 人格卡 + 纠正
└── SafetyPage           # 危机资源 / 使用时长 / 毕业
```

### 12.2 设计 Token（仿微信但**不复刻商标**）

| Token | 值 |
|---|---|
| `--bg` | `#EDEDED` / dark `#111111` |
| `--bubble-me` | `#95EC69` / dark `#3EB575` |
| `--bubble-her` | `#FFFFFF` / dark `#2C2C2C` |
| `--text` | `#191919` / dark `#E5E5E5` |
| `--sub` | `#B2B2B2` |
| `--nav-h` | `44px`（含安全区） |
| `--composer-h` | `56px` |
| `--radius` | `6px`（气泡）/ `4px`（头像） |
| `--font` | `system-ui, -apple-system, "PingFang SC", "Microsoft YaHei"` |
| `--font-size` | `17px`，行高 `1.45` |
| 气泡最大宽 | `70%` |
| 头像 | `40px`，圆角 `4px` |

### 12.3 必须做对的 8 个细节

1. **输入中**：三点跳动，节奏 1.2s/循环，可被"取消输入"打断（概率 8%）。
2. **分段到达**：多条消息间隔 0.6–2.2s，不是一次性出现。
3. **已读**：未回时显示"已读"，30–90 分钟后可能补一句。
4. **时间分隔**：超过 5 分钟插入时间戳。
5. **历史滚动**：向上加载，不跳动。
6. **语音条**：宽度随秒数变化，播放有波形。
7. **长按菜单**：复制 / 引用 / **撤回** / 删除（撤回见 7.7）。
8. **下拉**：露出"那年今天"的一张照片（若有媒体）。

### 12.4 三扇门

| 门 | 入口 | 行为 |
|---|---|---|
| 日常 | 默认进入 | 直接进聊天 |
| 回忆 | 首页卡片「翻一翻」 | 进入 episode 回放式对话，结束提示"回到现在？" |
| 深夜 | 23:00 后首页变暗 | 低语模式：更短、更慢、不给建议 |

### 12.5 四端打包（同一份代码）

```bash
pnpm tauri build                      # 当前平台
pnpm tauri build --target aarch64-apple-darwin
pnpm tauri android build             # .apk / .aab
pnpm tauri ios build                 # .ipa（需 macOS + Xcode）
```

| 端 | 产物 | 注意 |
|---|---|---|
| Windows | `.msi` / `.exe` | 需代码签名证书（否则 SmartScreen 拦截） |
| macOS | `.dmg` | 需 Apple Developer ID + 公证（notarization） |
| Android | `.apk`（自分发）/ `.aab`（商店） | 需签名 keystore；自分发可绕开商店审核 |
| iOS | `.ipa` | TestFlight 或 App Store；**审核风险最高**，见 03-PRD §10.4 |

**平台差异处理**：

| 能力 | 实现 | 差异 |
|---|---|---|
| DB 路径 | `app_data_dir` | 各端不同，统一由 Rust `path` 命令返回 |
| Keychain | `keyring` crate | Windows 凭据管理器 / macOS 钥匙串 / iOS Keychain / Android Keystore |
| 本地通知 | `tauri-plugin-notification` | iOS/Android 需运行时申请权限 |
| 文件选择 | `tauri-plugin-dialog` | 移动端从"文件 App / 下载目录"选 |
| HTTP | `tauri-plugin-http` | 四端一致，绕过 WebView CORS |

**主动消息在移动端的实现约束**：iOS/Android 不允许后台常驻。因此采用 **"前一晚预生成 + 系统定时本地通知"**：每晚 23:00 生成次日候选文案并写进通知队列，由系统按时触发；用户点通知直接进会话。**不依赖服务端推送**。

**降级预案**：若 Tauri 2 移动端在目标机型出现阻塞性问题，保留 `apps/app/src` 不变，仅替换壳为 **Capacitor**（`core` 为纯 TS，可零改动迁移）。这是唯一允许的架构回退路径。

---

## 13. 安全与隐私实现

| 项 | 实现 |
|---|---|
| 数据库加密 | SQLCipher，密钥由用户口令派生（Argon2id），存 Keychain |
| 启动锁 | 可选 4 位 PIN / 生物识别 |
| 日志 | 默认关闭详情日志；开启时脱敏姓名/手机号/地址 |
| 一键销毁 | 删除 db、media、keychain、缓存，覆写 2 次，输出回执 |
| 网络 | 默认只允许用户配置的 endpoint；内置域名白名单，防误传 |
| 导出 | 明文导出需二次确认 + 提示风险 |
| 遥测 | **MVP 无任何遥测**（这本身是卖点） |

---

## 14. 任务卡（按序执行）

> 每张卡含：产出物、验收标准、依赖。Agent 应逐卡交付，不得跳步。

| ID | 任务 | 产出 | 验收 | 依赖 |
|---|---|---|---|---|
| T01 | 仓库脚手架 | monorepo（`apps/app` + `packages/core` + `packages/shared`）+ Tauri 2 四端初始化 | 四端 `pnpm tauri dev` 均可启动空壳 | — |
| T02 | 数据库层 | DDL + 迁移 + SQLCipher 封装 | 建库/读写/加密验证通过 | T01 |
| T03 | 导入适配器框架 | `BaseAdapter` + 注册机制 + 3 个实现 | 3 种格式各解析 1000 条无异常 | T02 |
| T04 | burst/latency 补全 | 连发与延迟计算 | 与人工抽检 30 条一致率 >90% | T03 |
| T05 | 体检报告 | 报告 JSON + 前端展示 | 报告字段齐全，fidelity 估算合理 | T04 |
| T06 | 情绪标注 | 批量标注 + 重试 + 落库 | 1000 条标注成功率 >98% | T02 |
| T07 | 标注校准 | 200 条人工标注 + Kappa 计算 | Kappa ≥ 0.6 | T06 |
| T08 | Style Card | 统计脚本 + JSON 输出 | 字段全部有值，分布可视化 | T04 |
| T09 | Episode 切分 | 时间+话题切分算法 | 人工抽检 20 个 episode 合理率 >80% | T04 |
| T10 | 情境-反应对抽取 | Prompt + 解析 + 证据链 | 每 persona ≥30 条，无证据条目为 0 | T07,T09 |
| T11 | 事实抽取 + Fact Lock | fact 表 + 冲突检测 | 抽 20 条人工核对准确率 >85% | T09 |
| T12 | 情绪引擎核心 | 状态机 + 衰减 + 张力 | 单测覆盖 4 轴边界与惯性 | T07 |
| T13 | 转移矩阵 | 统计 + 查询接口 | 矩阵概率和为 1，抽样合理 | T07 |
| T14 | Arc Director | 场次判定 + 预算 + 强制转向 | 4 类场次各 10 轮回放通过 | T12 |
| T15 | Comfort Governor | 三律实现 + 脆弱度评分 | 20 个对抗样例全部拦截 | T12 |
| T16 | 检索层 | FTS5 + sqlite-vec + RRF | top5 相关率人工评估 >70% | T02 |
| T17 | 记忆装配 | L0-L3 组装 + 情绪一致加权 | 注入 token 数可控（<3000） | T16 |
| T18 | 未闭合话题 | 检测 + 生命周期 | 10 个样例正确识别 8 个 | T09 |
| T19 | 模型适配层 | OpenAICompat（含预设 7 家 + 自定义 base_url）+ 路由 + 重试 | 3 家 provider 跑通，流式正常，无本地推理依赖 | T01 |
| T20 | Compose 引擎 | Prompt 组装 + 流式 + 分段 | 首 token <2s，分段符合 burst | T19,T17 |
| T21 | AI 味过滤器 | 8 条规则 + 单测 | 50 条样例误杀率 <10% | T20 |
| T22 | Decide 引擎 | 回复概率/延迟/条数 | 延迟分布与 Style Card 拟合 | T08,T12 |
| T23 | 主动消息 | 欲望×机会 + 预算 + 队列 | 7 天模拟不超预算，reason 可读 | T18,T22 |
| T24 | 聊天 UI | 组件树 + 设计 token | 与设计稿像素差 <2px | T01 |
| T25 | 流式联调 | 流式事件 + typing + 分段 | 端到端延迟 <3s | T20,T24 |
| T26 | 引导流程 | 4 步向导 | 新用户 5 分钟内完成首次对话 | T05,T24 |
| T27 | 多模型设置页 | 配置/测试/切换 | 3 种 provider 配置成功 | T19,T24 |
| T28 | 四端打包 | Windows/macOS/iOS/Android 安装包 + 签名 | 干净机器安装即用 | T26 |
| T29 | 安全 | 加密/销毁/标识/Keychain | 销毁后数据不可恢复 | T02,T24 |
| T30 | 评测 | 盲测 harness + 回放 | 产出混淆率与情绪收益报告 | 全部 |
| T31 | 撤回重发 | `recallLast` + 系统提示 + 负例入库 + 防滥用 | 撤回后旧句不进入记忆；重发不重复 | T20,T25 |
| T32 | 移动端主动消息 | 预生成 + 本地定时通知 | 杀进程后仍能按时收到；点开直达会话 | T23,T28 |

**关键路径**：T01→T02→T03→T04→T08→T19→T20→T24→T25→T26→T31→T28→T32。
**可并行**：T06/T09 与 T16 可并行；T24 可在 T20 前用 mock 数据开工；T31 与 T30 可并行。

---

## 15. 测试与验收

### 15.1 自动化

- 单元测试：情绪引擎、过滤器、适配器（Vitest，覆盖率 >70%）。
- 回放测试：取 200 条真实对话，逐条输入引擎，输出与真实回复的**语义相似度**与**风格距离**。
- 黄金集：50 个情境 → 期望反应类型（不比对文本，比对"反应类别"）。

### 15.2 人工

- 盲测：300 条真实回复 + 300 条生成回复，随机混排，用户/AI 判定。目标混淆率 >50%（MVP），>60%（正式）。
- 情绪收益：会话前后 1-10 分自评（孤独/难过/平静），目标平静 +1.5。
- 出戏点记录：每次用户标记"不像"，记录上下文，周迭代。

### 15.3 性能预算

| 指标 | 目标 |
|---|---|
| 首 token | < 1.5s（取决用户所选 API 与网络） |
| 完整回复 | < 4s |
| 启动 | < 3s |
| 冷启动导入 5 万条 | < 90s |
| 内存占用 | < 500MB |
| 安装包 | < 80MB（桌面） |

---

## 16. 风险与降级

| 风险 | 降级方案 |
|---|---|
| 模型拒答 | 切备用 provider；仍失败则输出"她好像不太想说这个" + 转移话题 |
| 用户无 API key | **不做体验额度**（需服务端中转，违背"无服务器"原则）；改为配置向导 + 各平台申请教程 + "一键测通"引导；支持导入他人分享的配置模板（不含 key） |
| 数据太少（<1000 条） | 进入轻度模式，只启用 Style Card + 检索，不启用冲突 |
| 导入失败 | 提供"纯手工描述"路径（10 个问题生成基础人格） |
| Tauri 移动端构建受阻 | 壳替换为 Capacitor（core 为纯 TS，零改动） |
| 用户 API 额度耗尽 | 明确提示"她的额度用完了"，不假装网络问题 |
| 情绪引擎误判 | 提供"撤回"重发，负例直接进 Correction |

---

## 17. 交付定义（Definition of Done）

MVP 完成 = 以下全部成立：

1. 一个从没装过的人，能在 **5 分钟内**导入记录、看到体检报告、开始聊天。
2. 聊天框在视觉与节奏上"像一个真的聊天软件"（分段、输入中、已读）。
3. 她能主动发消息，且每条都有可读的"来由"。
4. 她会在被冒犯时变冷，且**3 轮内必定递台阶**。
5. 她能准确说出至少 5 个只有你们知道的细节。
6. 换一个模型 API，人格不崩（只有语感轻微变化）。
7. 一键销毁后，硬盘上找不到任何聊天内容。
8. **Windows / macOS / iOS / Android 四端同一版本可安装并跑通全流程**（联网调 API）。
9. 撤回后，那句被撤回的话**不再出现在任何上下文与记忆里**。
10. 盲测混淆率 ≥ 50%。
