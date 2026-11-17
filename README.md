# 常在（Still Here）· Windows PC 单端

> 把一段关系，做成一个还愿意陪你说说话的人。

本仓库是「常在」的 **PC 单端（Windows 优先）** 实现。当前进度：**Step 0（决策与准备）+ Step 1（技术底座 + 五项 spike）**。

- 产品与工程依据：`../项目规划与介绍/00-INDEX.md` ~ `03-prd.md`
- 执行方案：[`../项目规划与介绍/05-pc-only-execution-plan.md`](../项目规划与介绍/05-pc-only-execution-plan.md)
- 工作分解：[`../项目规划与介绍/04-workbreakdown-and-execution.md`](../项目规划与介绍/04-workbreakdown-and-execution.md)
- Step 0 产物：`docs/step0-*.md`
- Step 1 spike 报告：`docs/step1-spike-report.md`
- 构建产物：`release/changzai.exe`、`release/Changzai_0.1.0_x64-setup.exe`
- 验收脚本：`scripts/verify.ps1`（类型检查 + core 单测 + Rust 探针 + spike 套件）

## 仓库结构

```
changzai/
├── apps/app/                 # 唯一应用：React + Tauri 2（Windows 桌面）
│   └── src-tauri/            # Rust 宿主：SQLCipher / 通知 / 托盘 / 流式探测
├── packages/core/            # 纯 TS 核心（无 DOM / 无 Node API，可单测）
├── packages/shared/          # 类型、常量、设计 token
├── prompts/                  # Prompt 模板（随版本发布，不热更）
├── spikes/                   # Step 1 五项能力验证脚本（可独立运行）
├── scripts/                  # 环境与验证脚本
└── docs/                     # Step 0/1 决策、协议、报告
```

## 快速开始（Windows）

前置：Node 20+（推荐 24）、pnpm、Rust stable（MSVC）、Visual Studio 2022 C++ 工具、WebView2 Runtime。

```powershell
# 1. 当前机器已安装的环境（本仓库脚本会自动探测）
powershell -ExecutionPolicy Bypass -File scripts\env.ps1

# 2. 安装前端依赖
pnpm install

# 3. 跑核心单测（无需安装依赖，Node 24 原生跑 TS）
node --test packages/core/test/*.test.ts

# 4. 跑 Step 1 五项 spike（不需要编译 Tauri）
powershell -ExecutionPolicy Bypass -File scripts\run-spikes.ps1

# 5. 开发 / 打包桌面应用（脚本会自动装载 Node/Rust/MSVC）
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1     # Tauri dev（自动起 vite）
powershell -ExecutionPolicy Bypass -File scripts\build.ps1   # Windows 安装包（NSIS）
# 也可用：pnpm dev / pnpm build（根 package.json 已转发到上述脚本）
```

## 当前状态

| 项 | 状态 |
|---|---|
| Step 0 决策基线 | ✅ `docs/step0-decisions.md`（部分默认值待产品确认） |
| Step 0 导出/媒体指引 | ✅ `docs/step0-data-export-guide.md` |
| Step 0 holdout 协议 | ✅ `docs/step0-holdout-protocol.md` |
| Step 0 设计基线 | ✅ `docs/step0-design-baseline.md` |
| Step 1 monorepo | ✅ |
| Step 1 桌面壳（Tauri 2） | ✅ 已构建并启动验证（`docs/assets/step1-shell.png`） |
| Step 1 SQLCipher 加密库 | ⚠️ 本机缺 Perl/NASM/OpenSSL → 暂用 Argon2id+AES-256-GCM 回退（见 `docs/step1-spike-report.md` §3） |
| Step 1 FTS5 中文检索 | ✅ trigram recall@5 100%（Python + Rust 双验证） |
| Step 1 托盘 + Windows 通知 | ✅ 代码 + Toast 能力验证通过 |
| Step 1 Rust 流式 HTTP | ✅ 本地 chunked echo 测试通过 |
| Step 1 安装包 | ✅ `release/Changzai_0.1.0_x64-setup.exe`（NSIS，5.36MB，未签名） |

## 架构纪律（未来补移动端的前提）

1. `packages/core` 禁止出现 `window` / `fs` / `fetch` / `localStorage`；
2. 平台能力一律走注入接口（`DbPort` / `HttpPort` / `ClockPort` / `NotifyPort` / `KeyPort`）；
3. UI 不直接调 Rust 命令，统一走 core 的 `CoreAPI`（Step 2 起逐步接入）；
4. 数据格式带 `schema_version`，迁移可重放；
5. 调度（纯逻辑）与投递（平台实现）分离。
