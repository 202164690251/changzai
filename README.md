# veyrimi · 如晤

> 见字如晤，见你亦是。

**把同一个 ta，带进文字、声音、桌面与视频里的本地 AI 陪伴空间。**

[![CI](https://github.com/202164690251/veyrimi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/202164690251/veyrimi/actions/workflows/ci.yml)

- 平台：Windows 10 / 11（x64）
- 形态：Tauri 2 桌面应用，本地优先，无服务器、无遥测
- 当前版本：0.1.0 内测
- 数据：SQLCipher 加密，默认只存在本机
- 模型：用户自带 OpenAI 兼容接口；应用不内置聊天模型

---

## 她是什么

如晤不是“另一个聊天软件”。

它做的是：**把你熟悉的那个人，用聊天记录、人格卡、声音和 Live2D 重新组织出来，让她出现在不同形态里。**

- 在聊天窗口里，她像微信里的一个人；
- 在桌面上，她是一个会动、会回应、会自己待机的桌宠；
- 在语音里，她可以用 TTS 说话；
- 在视频窗口里，她以 Live2D 形象出现；
- 所有这些形态，共用同一份人格、关系、情绪和记忆。

> 这是一个 AI 模拟陪伴产品。所有回复由你配置的模型生成，不是真人，也不代表聊天记录中的对方本人。

---

## 当前功能

### 1. 聊天与创建

- 三栏微信桌面版风格界面，多会话列表；
- 两种开始方式：
  - 导入聊天记录，自动生成人格卡；
  - 8 个性格模板 / 结构化自定义，不依赖聊天记录；
- 6 种聊天记录适配器：
  - WeChatMsg TXT / CSV；
  - 留痕 JSON；
  - QQ TXT；
  - 直接粘贴；
  - 网页导出 `data.js`；
- 导入体检：消息数、时间跨度、夜间比例、缺失段、holdout；
- 人格卡：句长、语气词、高频短语、事实、参考对话、边界；
- 人格卡编辑与最多 10 版回滚；
- 关系卡：关系类型、称呼、关于你的事实，可编辑、可重新总结；
- 可变高度虚拟滚动、引用、重新编辑、撤回、删除、搜索；
- 图片/语音气泡、图片灯箱、语音播放；
- 夜间模式、90 分钟休息提醒、托盘常驻。

### 2. 人格、情绪、记忆与主动消息

- 四轴情绪：心情 / 精力 / 亲近 / 防备；
- 8 类默认心情，可手动覆盖；
- 情绪衰减、单轮硬限、四类 Arc；
- Comfort Governor：危机、依恋上限、脆弱、正常；
- 长期记忆 + SQLite FTS5 检索；
- 四层记忆装配：人格卡、关系卡、近期对话、检索记忆；
- 事实锁：20 条对抗样例；
- 主动消息：克制 / 适中 / 黏人 / 自定义；
- 预算、免打扰、活跃时段、最小空闲、检查间隔、概率阈值、连续未回上限；
- 主动消息带最近上下文，并经过质量过滤。

### 3. 语音

- Windows SAPI / OpenAI TTS；
- 语音气泡、自动朗读、回复语音概率；
- 麦克风录音 → STT 转写 → 确认发送；
- TTS 失败自动回退文字；
- 危机/安全提示默认不转语音。

### 4. Live2D 与桌宠

- 独立透明桌宠窗口，置顶、拖动、位置记忆；
- 图片桌宠：正方形裁剪、纯色背景去除、整体呼吸、点击弹跳；
- Live2D：
  - Cubism 4 `.model3.json` 文件夹 / zip 导入；
  - 多模型选择；
  - 动作组、表情、HitAreas；
  - Idle / Tap / 随机动作 / 随机表情；
  - 鼠标视线跟随；
  - TTS 口型（`ParamMouthOpenY` / `JawOpen`）；
  - VTube Studio `.vtube.json` 的 Hotkeys 自动转换成 Motions / Expressions；
- 行为状态机：idle / thinking / talking / dragging / sleeping / happy / annoyed；
- 深夜睡眠、摸头、戳一戳、喂食、连续戳生气；
- 自动动效活跃度、动作反馈、恢复默认表情；
- 滚轮缩放桌宠，下方聊天区固定；
- 快捷聊天、快捷回复、语音输入、Mini 旧兼容；
- V2.4 视频通话：
  - 独立 Tauri 窗口；
  - 当前聊天 Live2D / 图片回退；
  - TTS 播报 + 音量包络口型；
  - 接通 / 挂断 / 静音；
  - 不调用摄像头、不录像；
  - `VideoAvatarProvider` 接口预留 VRM / 云端数字人。

### 5. 数据、安全与隐私

- SQLCipher 整库加密；
- 启动 PIN；
- 加密 `.czbak` 备份：数据库 + 密钥 + 媒体；
- 一键销毁：3 次随机覆盖后删除；
- 本地统计、使用说明、AI 披露；
- 无服务器、无遥测；
- 只有你配置的模型 / TTS 服务商会收到对应请求内容。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面 | Tauri 2（Rust + WebView2） |
| 前端 | React 19 + TypeScript + Vite 7 |
| 核心逻辑 | `@veyrimi/core` 纯 TS，无 DOM / Node API |
| 数据 | SQLite + SQLCipher（rusqlite） |
| 检索 | SQLite FTS5 |
| Live2D | Cubism 4 Core + PixiJS 6 + pixi-live2d-display |
| 语音 | Windows SAPI / OpenAI 兼容 TTS + STT |
| 打包 | NSIS，内置 WebView2 Bootstrapper 与 OpenSSL 运行库 |

### 架构纪律

1. `packages/core` 不出现 `window` / `fs` / `fetch` / `localStorage`；
2. 平台能力通过 `DbPort` / `HttpPort` / `ClockPort` / `NotifyPort` / `KeyPort` 注入；
3. UI 不直接操作数据库，统一走 core / hooks；
4. 数据格式带 `schema_version`，迁移可重放；
5. 调度逻辑与平台投递分离。

---

## 仓库结构

```text
veyrimi/
├── apps/app/                 # React + Tauri 2 桌面应用
│   └── src-tauri/            # Rust：SQLCipher / 媒体 / TTS / 托盘 / 桌宠 / 视频窗口
├── packages/core/            # 纯 TS 核心：导入、人格、情绪、记忆、Prompt
├── packages/shared/          # 类型、常量、设计 token
├── prompts/                  # Prompt 模板
├── scripts/                  # 环境 / 开发 / 构建 / 验收
├── docs/                     # 产品、技术、路线、截图
├── site/                     # 静态官网
└── examples/                 # 合成聊天样本
```

---

## 快速开始

### 环境

| 依赖 | 版本 |
|---|---|
| Node.js | 24 LTS（≥20） |
| pnpm | 11.x |
| Rust | stable MSVC |
| Visual Studio 2022 | C++ 桌面开发 |
| OpenSSL | 3.x Win64（构建 SQLCipher 需要） |
| WebView2 Runtime | Windows 11 预装；Win10 由安装包 Bootstrapper 安装 |
| Strawberry Perl + NASM | 可选，仅 `sqlcipher-vendored` 自包含构建需要 |

```powershell
# 引导当前终端
powershell -ExecutionPolicy Bypass -File scripts\env.ps1

# 安装依赖
pnpm install

# 全量验收
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1

# 开发
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1

# 构建安装包（输出在 Tauri target 目录）
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

构建后把以下文件复制到 `release/`：

```text
veyrimi.exe
veyrimi_0.1.0_x64-setup.exe
libcrypto-3-x64.dll
libssl-3-x64.dll
```

安装包已内置 OpenSSL DLL；portable 版则需要把两个 DLL 放在 `veyrimi.exe` 同目录。

---

## 发布与复现

- `release/` 被 `.gitignore` 忽略，**安装包不进入 Git 仓库**；
- GitHub 仓库保存的是源码、资源、图标和构建脚本，不保存构建产物；
- 别人可以从源码复现，但需要 Node / pnpm / Rust / MSVC / OpenSSL 等完整构建环境；
- CI 只做类型检查、core 单测、Rust 测试和前端构建，**不会自动上传安装包**；
- 最省事的分享方式：把 `veyrimi_0.1.0_x64-setup.exe` 单独发给对方；
- 应用未签名，Windows SmartScreen 会提示；需要点“更多信息 → 仍要运行”。

---

## 当前未完成 / 后续版本

- 真人盲测、模型回归、情绪收益问卷；
- 代码签名、MSI、自动更新；
- VRM 3D 形象；
- 双向实时语音通话（当前视频是形象 + TTS 播报）；
- 图片语义分割、自动分层、眨眼 / 口型；
- 40+ / 104 动作内容库与动作编辑器；
- 屏幕感知、任务伴随；
- 云端同步 / 移动端（当前只做 Windows PC 单端）。

详细路线见：

- [`docs/step11-v2.3-mvp.md`](docs/step11-v2.3-mvp.md)
- [`docs/step7-plan.md`](docs/step7-plan.md)
- [`docs/`](docs/)

---

## 许可与素材

- 代码与产品素材按项目自身授权；
- Live2D Cubism Core 为 Live2D 专有运行时，遵守其许可；
- 用户导入的 Live2D 模型、聊天记录、头像、声音，权利归原权利人；
- 应用不内置第三方角色模型；
- 分享安装包时，不要附带他人的聊天记录、模型或声音。

---

## 协作

仓库：<https://github.com/202164690251/veyrimi>

- `main` 开启分支保护：PR + review + CI 全绿后 squash merge；
- 分支：`feat/<scope>-<short>` / `fix/<scope>-<short>` / `docs/<short>`；
- 详细规范见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

```powershell
git clone https://github.com/202164690251/veyrimi.git
cd veyrimi
pnpm install
```
