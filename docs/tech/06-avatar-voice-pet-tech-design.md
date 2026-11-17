# 常在 Still Here · 技术实现文档 v2

- 版本：0.2（规划稿）
- 日期：2026-11-18
- 基线：`main` / `411b54c`
- 适用：Windows 10/11、Tauri 2、React 19、Rust、SQLCipher
- 需求文档：`docs/product/06-feature-requirements-v2.md`

---

## 1. 现有架构回顾

```text
React (apps/app)
  ├─ ChatShell / MessageList / Composer
  ├─ useChat / useProactive / useEmotion / usePersona
  └─ Tauri invoke
        │
Rust (src-tauri)
  ├─ store.rs      SQLCipher、导入、设置、chat_message
  ├─ llm.rs        OpenAI 兼容 SSE
  ├─ safety.rs     备份/PIN/销毁
  └─ media.rs      媒体读取
        │
Core TS (packages/core)
  ├─ persona       人格卡/关系卡/prompt
  ├─ runtime       情绪/Arc/Governor/记忆/质量过滤
  ├─ ingest        导入适配器
  └─ emotion/mood  状态
```

本版不重写聊天引擎，只在现有架构上增加五个独立域：

```text
ChatDomain   Persona + Relationship + Emotion + Memory + ChatMessage
AvatarDomain AvatarProfile + 2D/3D 资源（不进入 chat prompt）
VoiceDomain  VoiceProfile + TTS/STT + 概率策略
PetDomain    Tauri 第二窗口 + Live2D 渲染
VideoDomain  R&D：虚拟形象视频 / 真人感数字人
```

原则：**Avatar/Voice/Pet 只能订阅 ChatDomain 的事件，不能反向修改人格/记忆/聊天内容。**

---

## 2. 数据模型

### 2.1 Persona 扩展

```ts
type PersonaOrigin = "distilled" | "preset" | "custom";

interface PersonaProfile {
  // 现有字段...
  origin?: PersonaOrigin;       // 新增，旧数据默认 distilled
  preset_id?: string;           // 仅 preset
  custom_prompt?: string;       // 仅 custom 的高级后缀
}
```

- 旧 `persona.profile` 缺 `origin` 时按 `distilled` 处理；
- 三种创建方式最终都调用同一个 `personaSave`；
- 聊天运行时不需要知道 origin，最多用于 UI 展示。

### 2.2 AvatarProfile（独立表/设置）

建议使用 SQLCipher 表，避免设置 JSON 膨胀：

```sql
CREATE TABLE IF NOT EXISTS avatar_profile (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- image | live2d | vrm
  asset_path TEXT NOT NULL,       -- 本地相对路径
  config_json TEXT,               -- 缩放/锚点/表情/动作映射
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- 与 `persona` 一对一，可空；
- 不参与 `buildSystemPrompt`；
- 删除/替换不影响人格、聊天、记忆。

### 2.3 VoiceProfile

```sql
CREATE TABLE IF NOT EXISTS voice_profile (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  provider TEXT NOT NULL,          -- system | openai | azure | elevenlabs | gpt-sovits | cosyvoice
  provider_voice_id TEXT,          -- 云端 voice id
  sample_paths_json TEXT,          -- 本地样本路径（不存云端返回的原始音频）
  consent_at INTEGER NOT NULL,
  status TEXT NOT NULL,            -- ready | processing | failed
  created_at INTEGER NOT NULL
);
```

设置项：

```ts
interface VoiceSettings {
  enabled: boolean;                // 总开关，默认 false
  replyProbability: number;        // 0..1，默认 0.3
  proactiveProbability: number;    // 0..1，默认 0.3
  provider: string;
  voiceProfileId?: string;
  autoPlay: boolean;               // 默认 false
  sttEnabled: boolean;             // 语音输入，默认 false
}
```

### 2.4 ChatMessage 扩展

当前 `chat_message.payload` 存整个 ChatMsg JSON。语音消息扩展：

```ts
type ChatMsg =
  | TextMessage
  | ImageMessage
  | VoiceMessage
  | {
      id: string;
      from: "her" | "me" | "system";
      kind: "voice";
      text?: string;              // 转写/原文
      audioPath?: string;        // 本地文件；比 dataURL 更省 DB
      durationSec: number;
      ts: number;
    };
```

- 新增语音文件放 `%APPDATA%\com.changzai.stillhere\media\voice\`；
- DB 存路径与元数据，不存大 base64；
- 旧 dataURL 语音继续兼容；
- 备份时把 `media/` 打包（现有 `.czbak` 已支持 media）。

### 2.5 PetSettings

```ts
interface PetSettings {
  enabled: boolean;            // 默认 false
  alwaysOnTop: boolean;        // 默认 true
  clickThrough: boolean;       // 默认 false
  x?: number;
  y?: number;
  scale: number;
  idleAnimation: boolean;
  speechBubble: boolean;
}
```

存 `setting` 表即可，不需要新表。

---

## 3. 创建方式实现

### 3.1 统一接口

```ts
interface PersonaDraft {
  origin: PersonaOrigin;
  name: string;
  style: Partial<PersonaStyle>;
  summary: string;
  facts: PersonaFact[];
  samples: PersonaSample[];
  boundaries: string[];
  relationship?: Partial<RelationshipProfile>;
}
```

- `preset`：模板数据 + 少量默认值；
- `custom`：表单字段映射；
- `distilled`：现有 `buildPersonaProfile`。
- 最后统一 `materializePersona(draft): PersonaProfile`，写入现有存储。

### 3.2 MBTI/性格预设

文件建议：

```text
packages/core/src/persona/presets.ts
packages/core/src/persona/preset-data.ts
```

```ts
interface PersonaPreset {
  id: string;
  label: string;
  tagline: string;
  style: Partial<PersonaStyle>;
  summary: string;
  facts: PersonaFact[];
  samples: PersonaSample[];
  boundaries: string[];
  defaultRelationship: RelationshipType;
}
```

- 首版 8 个模板，不做 16 型全量；
- 每个模板的 samples 是合成对话，不涉及真实用户；
- 生成后仍可编辑/回滚；
- `origin="preset"`，不显示“已导入 N 条记录”。

### 3.3 提示词自定义

表单字段映射到 `PersonaProfile`，不直接存裸 system prompt：

```ts
interface CustomPersonaForm {
  identity: string;
  relation: RelationshipType;
  tone: "gentle" | "playful" | "cold" | "tsundere" | "quiet";
  sentenceLength: "short" | "medium" | "long";
  initiative: number;       // 0..1
  emojiLevel: number;       // 0..1
  catchphrases: string[];
  likes: string[];
  dislikes: string[];
  boundaries: string[];
  advancedPrompt?: string;
}
```

- `advancedPrompt` 只追加到人格段，不覆盖安全规则；
- 事实锁、Governor、危机资源仍在 runtime 层强制执行；
- 保存前用 3 句固定 prompt 预览。

---

## 4. 语音实现

### 4.1 总开关与概率策略

新增纯 TS 模块：

```text
packages/core/src/voice/policy.ts
```

```ts
interface VoiceDecisionInput {
  enabled: boolean;
  probability: number;
  kind: "reply" | "proactive";
  crisis: boolean;
  ttsAvailable: boolean;
  random: number;       // 0..1，便于测试
}

function shouldSpeak(input: VoiceDecisionInput): boolean {
  if (!input.enabled || !input.ttsAvailable) return false;
  if (input.crisis) return false;          // 危机优先文字
  return input.random < input.probability;
}
```

- `reply` 与 `proactive` 分开概率；
- 随机数注入，单测可复现；
- 关闭时 **不调用 TTS**，不是生成后丢弃；
- TTS 失败捕异常，回退文字。

### 4.2 TTS Provider 抽象

```ts
interface TtsProvider {
  id: string;
  synthesize(input: {
    text: string;
    voiceId?: string;
    speed?: number;
    format: "mp3" | "wav";
  }): Promise<{ audio: Uint8Array; mime: string; durationMs?: number }>;
}
```

候选：

| Provider | 类型 | 优点 | 缺点 |
|---|---|---|---|
| Windows SAPI | 本地 | 免费、离线 | 音色机械 |
| Edge TTS | 云/免费 | 音色自然、接入快 | 依赖网络/服务条款 |
| OpenAI TTS | 云 | 稳定、多音色 | 付费、需 Key |
| Azure TTS | 云 | 音色多、可控 | 付费、配置复杂 |
| GPT-SoVITS | 本地 | 可克隆、隐私好 | 需模型/GPU、包体大 |
| CosyVoice | 本地/云 | 中文自然、可克隆 | 部署复杂 |

实现建议：

- 首版：Windows SAPI + 一个云 TTS（OpenAI/Edge）二选一；
- 声音克隆：单独 `VoiceCloneProvider`，不混入 TTS 主流程；
- 本地模型不默认打包，首次使用时下载/安装，避免安装包过大。

### 4.3 声音上传/克隆流程

```text
选择音频 → 读取时长/采样率 → 质量检查
  → 授权勾选 → 上传/本地处理
  → 生成 VoiceProfile（processing）
  → 试听 3 句 → 确认
  → status=ready
```

质量门槛：

- 时长 10s–5min；
- 单人、少噪声；
- 采样率 ≥16kHz；
- 静音比例 <40%；
- 不支持多人混音/音乐。

安全：

- 必须勾选“我有权使用该声音”；
- 声音只用于本机 TTS；
- 提供删除样本/删除 VoiceProfile；
- 云端处理明确告知并记录 consent_at；
- 不提供声音导出/分享。

### 4.4 TTS 消息流

```text
用户发送文字
  → runtime 生成回复文本
  → shouldSpeak(reply)
    ├─ false → 追加 text 消息
    └─ true  → TTS 合成
         ├─ 成功 → 追加 voice 消息（text=回复文本, audioPath）
         └─ 失败 → 追加 text 消息
```

主动消息同理，`kind="proactive"`。

### 4.5 STT 流程

```text
麦克风按钮（按住/点击）
  → MediaRecorder / WebAudio 采集
  → 16kHz mono WAV/Opus
  → Rust command save_temp_audio
  → STT provider（本地 whisper.cpp / 云）
  → 文本填入 Composer
  → 用户编辑/确认发送
```

- 不做后台监听；
- 录音权限失败给出明确提示；
- 录音临时文件发送/取消后删除；
- 本地 whisper 模型按需下载，不默认打包。

### 4.6 Rust 侧

新增：

```text
src-tauri/src/voice.rs
  - voice_save_audio(bytes, mime) -> path
  - voice_delete_audio(path)
  - voice_transcribe(path) -> text   // 调本地/云 provider
  - voice_synthesize(text, voiceId) -> path
```

- 音频文件放 app data，不放仓库；
- 所有路径做 `..`/绝对路径校验；
- 备份时 `collect_media` 已递归打包 media。

---

## 5. 虚拟形象实现

### 5.1 隔离设计

```text
PersonaProfile ── 聊天运行时唯一输入
AvatarProfile ── 仅 UI/桌宠/视频渲染
```

- `buildSystemPrompt` 不接收 AvatarProfile；
- `useChat` 不依赖 AvatarProfile；
- 更换形象只触发 UI 重渲染；
- 自动化测试：同一 persona、同一输入，更换 avatar 后 prompt 哈希不变。

### 5.2 形象类型

| 类型 | 首版 | 说明 |
|---|---|---|
| image | ✅ | 上传/裁剪；聊天头部/桌宠共用 |
| live2d | P2 | Cubism 模型；桌宠/视频 |
| vrm | R&D | Three.js + three-vrm；3D 桌宠/视频 |
| ai-generated image | 可选 | 图片生成 API；用户自备 Key |

不承诺“文本生成 3D 模型”。

### 5.3 渲染位置

- 聊天头部：可选小头像；
- 形象设置页：大预览；
- 桌宠窗口：Live2D/VRM；
- 视频窗口：Live2D/VRM；
- 四处共用同一个 `AvatarProfile`，但渲染器独立。

### 5.4 资源存储

```text
%APPDATA%\com.changzai.stillhere\media\avatar\<persona-id>\
```

- 图片：webp/png；
- Live2D：model3.json + textures；
- VRM：单个 .vrm；
- 资源大小提示；删除形象时清理目录。

---

## 6. 桌宠实现

### 6.1 Tauri 多窗口

```rust
// 伪代码
WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html#/pet".into()))
    .title("常在桌宠")
    .inner_size(260.0, 320.0)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()?;
```

React：

```text
apps/app/src/pet/PetWindow.tsx
apps/app/src/pet/usePetBridge.ts
```

- 独立入口/路由，不加载 ChatShell；
- 只渲染形象、气泡、右键菜单；
- 通过 Tauri event 与主窗口通信：

```text
pet://say          主窗口/主动消息 → 桌宠气泡 + TTS
pet://open-chat    桌宠双击 → 显示主窗口
pet://state        情绪/状态同步
main://pet-settings 设置变更
```

- 数据通过 invoke 读取 `chat_message`/`persona`，不复制 React 状态。

### 6.2 交互实现

| 交互 | 实现 |
|---|---|
| 拖动 | `data-tauri-drag-region` 或 Rust `start_dragging` |
| 单击 | 冒泡/播放短句 |
| 双击 | `show_main_window` |
| 右键 | 原生菜单/HTML 菜单 |
| 置顶 | `set_always_on_top` |
| 穿透 | `set_ignore_cursor_events` |
| 位置记忆 | 拖动结束写入 `pet.settings` |
| 隐藏 | 关闭窗口/设置关闭 |

### 6.3 动画

- 首版：Live2D idle（呼吸/眨眼）+ 说话时的简单口型/表情；
- 拖动、点击反馈；
- 隐藏/全屏时暂停 RAF；
- 目标：待机 CPU 低；透明窗口避免全屏覆盖。

### 6.4 参考选择

**首版选 [BV1SeHw6VEeW](https://www.bilibili.com/video/BV1SeHw6VEeW/) 的 Live2D 桌宠路线。**

- 直接操作 + 待机动画 = 更强的“宠物感”；
- 不依赖屏幕捕获，权限/隐私/兼容性风险低；
- 工程可拆分：窗口 → 拖动 → 气泡 → Live2D → 主动消息。

**第二阶段再考虑 [BV1eAs96TEM2](https://www.bilibili.com/video/BV1eAs96TEM2/) 的屏幕陪伴能力。**

- 它更像“能陪打电话/看视频/打游戏的 Agent”；
- 需要屏幕捕获、应用集成、更多权限；
- 适合作为“陪你看/玩”高级模式，不应作为桌宠默认形态。

### 6.5 性能与兼容

- 关闭时销毁 WebView 或暂停；
- 透明窗口在 Windows 上测试 DWM/多屏/DPI；
- 全屏游戏可自动隐藏（可选）；
- 必须提供“退出桌宠”而非只能强杀。

---

## 7. 视频互动实现

### 7.1 两条路线

| 路线 | 参考 | 技术 | 成本/风险 | 结论 |
|---|---|---|---|---|
| A 真人感数字人 | [BV1Uq4q6dEEA](https://www.bilibili.com/video/BV1Uq4q6dEEA/) | 真人视频/照片 + 实时口型/表情，云 GPU 或预生成 | 高：肖像权、deepfake、延迟、费用 | R&D，不承诺首发 |
| B 虚拟形象视频 | [BV1hdHN6dETa](https://www.bilibili.com/video/BV1hdHN6dETa/) | Live2D/VRM + TTS + 口型 | 中：渲染、音画同步 | **先做 MVP** |

### 7.2 B 的架构

```text
VideoWindow (React)
  ├─ AvatarRenderer (Live2D/VRM)
  ├─ AudioPlayer (TTS)
  ├─ LipSyncDriver (音量/音素)
  └─ CallControls (接听/挂断/静音)
        │ Tauri events
VideoSession (Rust/TS)
  ├─ state: idle | connecting | active | ended
  ├─ audio pipeline
  └─ transcript → chat_message（可选）
```

- 视频窗口独立于主聊天；
- 不默认开启摄像头；
- 用户语音→STT→runtime→TTS→口型；
- 断网/超时/无 TTS 时提示并回退文字；
- 不默认录制。

### 7.3 A 的 R&D 门槛

先做 spike，不进入排期：

1. 延迟：端到端 <1.5s 是否可达；
2. 成本：每分钟云 GPU/视频生成费用；
3. 质量：口型/表情是否明显恐怖谷；
4. 合规：肖像授权、AI 标识、不得换脸他人；
5. 包体：模型/服务是否可接受。

未通过则只保留 B。

### 7.4 视频与聊天分离

- 视频是独立窗口/模式；
- 结束回聊天，不改变聊天布局；
- 视频内容默认不写入聊天记录；用户可开启“通话摘要写入”；
- 形象设置/语音设置不自动改变聊天行为。

---

## 8. 设置与 UI

### 8.1 设置结构

```text
设置
├─ 人格与关系
├─ 语音互动
│   ├─ 总开关（默认关）
│   ├─ 回复语音概率
│   ├─ 主动语音概率
│   ├─ 音色/声音样本
│   └─ 语音输入
├─ 虚拟形象
│   ├─ 上传/裁剪
│   ├─ 聊天中显示
│   └─ 桌宠使用
├─ 桌宠
│   ├─ 开启
│   ├─ 置顶/穿透
│   ├─ 动画
│   └─ 位置重置
└─ 视频（实验）
```

- 全部折叠在现有设置抽屉；
- 不新增主导航；
- 关闭后界面回到当前状态。

### 8.2 失败降级

| 失败 | 行为 |
|---|---|
| TTS 不可用 | 文字回复 |
| 声音克隆失败 | 预设音色/文字 |
| STT 失败 | 保留录音，可重试/手动输入 |
| 形象加载失败 | 默认头像，不影响聊天 |
| 桌宠崩溃 | 主窗口不受影响，可重开 |
| 视频不可用 | 回到语音/文字 |

---

## 9. 安全与隐私

- 聊天/人格/记忆/语音样本默认本地 SQLCipher；
- 云 TTS/STT/克隆/形象生成：单独开关 + 明确告知 + 可删除；
- 声音克隆必须授权；AI 生成内容标识；
- 视频/桌宠不默认录屏/录像；
- 屏幕感知必须显式授权，且可随时关闭；
- 危机场景优先文字与现实求助资源；
- 数据销毁/备份覆盖新增的 avatar/voice 资源。

---

## 10. 测试计划

### 10.1 单元测试

- `preset` 生成合法 PersonaProfile；
- `custom` 字段映射与边界；
- `shouldSpeak`：关闭=0、危机=false、概率边界；
- 形象变更不改变 system prompt；
- TTS 失败回退文字；
- 语音消息持久化/恢复。

### 10.2 Rust 测试

- 音频保存/删除路径校验；
- media 递归清理；
- chat_message 语音 payload roundtrip；
- 备份包含 voice/avatar 资源。

### 10.3 手工验收

- 无记录创建 → 首条消息；
- 关闭语音 20 轮无 TTS；
- 上传音频→预览→删除；
- 桌宠拖动/双击/右键/置顶/穿透/多屏；
- 形象切换不影响聊天；
- 视频挂断回聊天；
- 危机场景仍给求助资源。

### 10.4 性能

- 桌宠隐藏 CPU/内存；
- TTS 不阻塞文字首字；
- Live2D 30fps 上限；
- 安装包增量。

---

## 11. 迁移与兼容

- 旧 `persona.profile` 无 `origin` → `distilled`；
- 旧聊天记录/语音 dataURL 继续兼容；
- `avatar_profile`/`voice_profile` 新表用 `CREATE TABLE IF NOT EXISTS`；
- 旧备份恢复后缺新表时自动创建；
- 功能开关默认关闭，升级不改变现有体验；
- 语音/形象资源放 `media/`，随备份/销毁处理。

---

## 12. 实施阶段

### P0 数据模型与开关（3–5 天）

- `origin` 字段；
- `avatar_profile`/`voice_profile` 表；
- `VoiceSettings`/`PetSettings` 默认关闭；
- 迁移测试。

### P1 创建方式（5–10 天）

- 8 个预设模板；
- 结构化自定义表单；
- 引导页三选一；
- 预览/编辑；
- 与现有 persona 存储打通。

### P2 语音（10–15 天）

- TTS provider + 总开关 + 概率；
- 上传音频/声音克隆；
- STT；
- 语音消息持久化/播放；
- 失败降级。

### P3 形象 + 桌宠（15–25 天）

- 图片形象/裁剪；
- Tauri pet 窗口；
- 拖动/点击/气泡/右键；
- Live2D 渲染；
- 性能/多屏/DPI。

### P4 视频 MVP（15–25 天）

- 虚拟形象视频窗口；
- TTS + 口型；
- 接听/挂断/静音；
- 不默认录制。

### R&D：真人感数字人（不设承诺日期）

- 延迟/成本/质量/合规 spike；
- 通过再排期。

---

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 声音克隆滥用 | 授权勾选、AI 标识、仅本机、可删除 |
| 真人视频 deepfake | 仅授权素材、显著标识、不做他人换脸 |
| 屏幕捕获隐私 | 默认关闭、显式授权、可随时停止 |
| Live2D/VRM 版权 | 用户自备模型/授权素材，不内置未授权模型 |
| 安装包过大 | 模型按需下载，默认只带轻量资源 |
| 桌宠性能 | 隐藏暂停、30fps、低性能模式 |
| 云服务费用 | 预算提示、默认关闭、可降级本地 |
| MBTI 刻板印象 | 8 模板、文案声明、可编辑 |
| 语音/视频破坏聊天简洁 | 独立窗口/开关，默认关闭 |

---

## 14. 待确认决策

1. 声音克隆首版用本地（GPT-SoVITS/CosyVoice）还是云（ElevenLabs/Azure）？
2. 桌宠首版只做 Live2D，还是同时支持 VRM？
3. 视频 MVP 是否接受“2D 虚拟形象 + 口型”而不是真人感？
4. 屏幕感知/陪看视频是否进入下一版？
5. MBTI 模板 8 个是否够，是否需要 16 型？
6. 是否允许用户上传非本人声音？建议只允许本人或已授权声音。
