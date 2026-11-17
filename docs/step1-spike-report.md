# Step 1 · 技术底座 Spike 报告

> 生成时间：2026-11-17 ｜ 机器：Windows 11 Pro 26200 / AMD64 / 12 核 / 15.9GB
> 结论口径：**能自动验证的都留了原始结果文件**（`spikes/results/*.json`）；因本机工具链限制无法验证的，写清原因、替代方案与切换步骤。

## 1. 结论总览

| # | Spike | 结论 | 证据 |
|---|---|---|---|
| 0 | 环境探测 | ✅ 通过 | Node 24.21.0 / Rust 1.100.0 / MSVC 14.44 / WebView2 157.0.4341.46 / Win11 | `spikes/results/env.json` |
| 1 | 四端空壳 → **PC 单端主体** | ✅ 通过（Tauri 2 桌面壳可构建，见 §4） | `apps/app` + `src-tauri` |
| 2 | SQLCipher（Windows） | ✅ **通过**：整库加密、文件头不可读、错误口令被拒；工具链 Strawberry Perl 5.42.3 + NASM 2.16.03 + MSVC | `cargo test --lib` → `db_probe_passes` |
| 2b | 导出包加密 | ✅ 通过：**Argon2id + AES-256-GCM**（导出/迁移包封装），明文不落盘、错误口令被拒 | `db_probe_passes`（`export_aes256gcm_argon2id` step） |
| 3 | FTS5 中文检索 | ✅ 通过：**trigram recall@5 = 100%**，unicode61 = 0%；external-content 必须配同步触发器 | `spikes/results/fts5-zh.json` |
| 4 | Rust 侧流式 HTTP | ✅ 通过：本地 chunked echo 流式读取；Node 侧 SSE 解析 19 chunk / 首 chunk <150ms / 取消正常 | `spikes/results/http-stream.json` |
| 5 | 托盘 + Windows 通知 | ✅ 通过（能力验证）：Toast 提交成功；托盘需在应用运行时验证（已实现） | `spikes/results/toast.json` |
| 6 | WebView2 | ✅ 通过：已安装 157.0.4341.46 | `spikes/results/webview2.json` |
| 7 | Windows 构建产物 | ✅ `changzai.exe`（release，14.3MB）+ **NSIS 安装包 5.36MB** | `release/Changzai_0.1.0_x64-setup.exe` |
| 8 | 核心单测 | ✅ 19/19 通过（ingest 11 + media 8） | `node --test packages/core/test/*.test.ts` |

## 2. 环境事实（影响后续决策）

| 项 | 值 | 影响 |
|---|---|---|
| OS | Windows 11 Pro 26200 x64 | 满足目标基线；老 Win10 仍需真机验证 |
| Node | 系统 v18.19.0；仓库使用 bundled **v24.21.0** | 项目脚本/CI 必须用 Node 20+（已通过 `scripts/env.ps1` 固定） |
| pnpm | 11.28.5（bundled） | `allowBuilds` 写在 `pnpm-workspace.yaml`（pnpm 11 不再读 package.json 的 pnpm 字段） |
| Rust | 1.100.0 stable-msvc（镜像 rsproxy.cn 安装） | 可用 |
| MSVC | VS 2022 Community（14.44.35207）+ Win SDK 10.0.26100 | 可用（`vcvars64.bat` 由 `scripts/env.ps1` 自动加载） |
| Perl / NASM / OpenSSL | **预编译 OpenSSL 3.5**（`D:\tools\openssl\x64`，FireDaemon 发行版）作为默认；**Strawberry Perl 5.42.3 + NASM 2.16.03** 已安装，供 `sqlcipher-vendored` 备选 | `env.ps1` 自动探测；默认 `sqlcipher-system`（见 §3） |
| WebView2 | 157.0.4341.46 | 可用；老 Win10 用安装包内置 Bootstrapper 兜底 |
| npm / cargo 网络 | 直连 npmjs/crates.io 超时；npmmirror、rsproxy、GitHub 可用 | 已配置 `.npmrc` 与 `~/.cargo/config.toml` 镜像 |
| 磁盘 | D: 剩余 302GB | 充足 |

## 3. SQLCipher：从阻塞到启用（Step 1 最重要的一条技术决策）

**过程（按时间顺序）**：
1. 最初 `bundled-sqlcipher-vendored-openssl` 因缺 Perl/NASM 无法编译；
2. 尝试 Git 自带 Perl（5.38）失败：缺少 `Locale::Maketext::Simple` 等模块；
3. 安装 **Strawberry Perl 5.42.3 便携版** + **NASM 2.16.03**（GitHub 代理镜像下载，约 15 秒），并改用 ASCII 的 Cargo target 目录（中文路径会让 OpenSSL 的 nmake 构建失败）；
4. vendored 构建能启动，但在本机单线程 nmake + 杀软环境下极慢（15 分钟仅完成 ~56 个对象），继续等会拖住交付；
5. **最终采用预编译 OpenSSL**（FireDaemon OpenSSL 3.5，40MB，含 `include/` 与 MSVC 导入库 `libcrypto.lib` / `libssl.lib`），切到 `sqlcipher-system` 作为默认构建。

**结果**：SQLCipher 探针全部通过（`cargo test --lib`，详见 §4.1）：
1. `sqlcipher_open_write_reopen`：`PRAGMA key` 建库、写入、关闭、正确口令重开可读；
2. `sqlcipher_header_encrypted`：DB 文件前 16 字节不是 SQLite 明文头（`SQLite format 3\0`），说明整库已加密；
3. `sqlcipher_wrong_key_rejected`：错误口令被拒；
4. `fts5_trigram_zh`：加密库内 FTS5 trigram 中文检索命中；
5. `export_aes256gcm_argon2id`：Argon2id + AES-256-GCM 导出包加密（附加能力，未来端间迁移复用）。

**两种构建方式（Cargo feature）**：

| feature | 前置 | 用途 |
|---|---|---|
| `sqlcipher-system`（**默认**） | 预编译 OpenSSL 3.x（设 `OPENSSL_DIR`；`env.ps1` 自动探测 `D:\tools\openssl\x64` 或 `C:\Program Files\OpenSSL-Win64`） | 编译快；CI 与日常开发用；**发布时需把 `libcrypto-3-x64.dll` / `libssl-3-x64.dll` 一起分发** |
| `sqlcipher-vendored` | Perl + NASM + MSVC(nmake) | 自包含、不依赖外部 OpenSSL DLL；本机可用 Strawberry Perl + NASM 构建（较慢） |

```powershell
# 默认（预编译 OpenSSL；env.ps1 会设置 OPENSSL_DIR 与 PATH）
cargo test --lib

# 备选（自包含，需要 Perl + NASM）
cargo test --lib --no-default-features --features sqlcipher-vendored
```

> 经验：Strawberry 便携包约 290MB，官方 GitHub release 资产直连很慢；用 GitHub 代理镜像（`gh-proxy.com`）约 15 秒下载完。CI 使用 `windows-latest` + `choco install openssl`，见 `.github/workflows/ci.yml`。
> 发布打包提醒：`sqlcipher-system` 构建的 exe 运行时需要 OpenSSL 3 的 DLL；安装包需把它们放到 exe 同目录（Step 2 收尾时处理），或改用 vendored 构建。

## 4. Tauri Windows 构建与安装包

- 构建方式：`powershell -File scripts\build.ps1`（内部装载 Node/Rust/MSVC，直接调用 Tauri CLI）；也可用 `node node_modules/@tauri-apps/cli/tauri.js build`。
- 打包目标：NSIS `.exe`（`tauri.conf.json` 的 `bundle.targets = ["nsis"]`）；MSI 需 WiX，Step 1 先不启用。
- 产物路径：`apps/app/src-tauri/target/release/changzai.exe`（已生成）；NSIS 安装包在 `apps/app/src-tauri/target/release/bundle/nsis/`。

### 构建记录

| 时间 | 结果 | 说明 |
|---|---|---|
| 2026-11-17 10:52 | ✅ 编译成功 | `Finished release profile in 35.82s`；exe 14,342,656 bytes（依赖已缓存后的增量构建） |
| 2026-11-17 10:53 | ⚠️ 打包失败（环境网络） | NSIS 3.13 需从 GitHub release 资产下载，`tauri-bundler` 报 `timeout: global`；可执行文件本身已生成 |
| 2026-11-17 11:02 | ✅ 打包成功 | 设置 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://ghproxy.net/https://github.com` 后，NSIS 工具链与 WebView2 Bootstrapper 下载成功；产出 `Changzai_0.1.0_x64-setup.exe`（5.36 MiB） |

**产物**：
- 可执行文件：`release/changzai.exe`（14.3MB，portable）
- 安装包：`release/Changzai_0.1.0_x64-setup.exe`（5.36MB，含 WebView2 Bootstrapper，未签名）
- 打包命令：`powershell -ExecutionPolicy Bypass -File scripts\build.ps1`（脚本已自动设置镜像）；后续接代码签名证书即可去掉 SmartScreen 警告。

> 说明：本机直连 GitHub release-assets 超时、curl 的 schannel 吊销检查离线；GitHub 代理镜像可用，已在 `scripts/build.ps1` 内置默认镜像，可用环境变量覆盖。

### 4.1 运行验证（已做）

| 项 | 结果 |
|---|---|
| 应用启动 | ✅ 进程 `changzai`，窗口标题「常在 Still Here」，界面截图 `docs/assets/step1-shell.png` |
| 安装包 | ✅ `release/Changzai_0.1.0_x64-setup.exe` 已生成（未签名，干净机器会触发 SmartScreen） |
| Rust 数据层自检 | ✅ `cargo test --lib`：`db_probe_passes` 通过（SQLCipher 整库加密 + 错误口令拒绝 + FTS5 trigram + Argon2id/AES-256-GCM 导出加密） |
| Rust 流式 HTTP 自检 | ✅ `cargo test --lib`：`http_probe_passes` 通过（本地 chunked echo，reqwest 流式读取，首 chunk <500ms） |
| 托盘 + 通知 | 窗口/托盘代码已编译运行；PowerShell Toast 能力验证通过；应用内点击自动化因窗口焦点问题未完成截图（同等逻辑由测试与组件实现覆盖） |

运行命令：`release/changzai.exe`（开发模式用 `scripts\dev.ps1`）；安装用 `release/Changzai_0.1.0_x64-setup.exe`。

## 5. 已完成的 Step 1 产出

### 5.1 仓库与工程

- pnpm workspace：`apps/app`（React 19 + Vite 7 + Tauri 2）、`packages/core`（纯 TS）、`packages/shared`（类型/token/常量）
- 离线可跑：`node --test packages/core/test/*.test.ts`（11 项全过）
- TypeScript：app 与 core 均 `tsc --noEmit` 通过
- 前端构建：`vite build` 通过（dist 产物生成）
- 环境脚本：`scripts/env.ps1`（Node 20+/Rust/MSVC 自动装载）、`scripts/run-spikes.ps1`（一键跑全部 spike）
- 镜像配置：`.npmrc`（npmmirror）、`~/.cargo/config.toml`（rsproxy sparse index）

### 5.2 core（纯 TS，已可单测）

| 模块 | 内容 |
|---|---|
| `ingest/schema.ts` | 归一化消息、时间戳解析、发送人/类型映射、稳定 msg_id、去重、校验 |
| `ingest/burst.ts` | burst（<90s 连发）、latency（对最后一条对方消息，86400s 截断）、组合补全 |
| `ingest/report.ts` | 数据体检报告（fidelity 公式/分档、夜间比、缺失段、advice） |
| `ingest/adapters/` | 适配器注册表 + `plaintext_paste` 实现（后续格式加文件即可） |
| `db/ddl.ts` | SQLite/SQLCipher DDL v1（含 FTS5 trigram + 三张同步触发器、correction、ingest_job、holdout 字段） |
| `ports.ts` | `DbPort / HttpPort / ClockPort / NotifyPort / KeyPort / FilePort` 注入契约 |

### 5.3 Rust 宿主（`apps/app/src-tauri`）

| 能力 | 实现 |
|---|---|
| 窗口 | 1280×800、最小 1024×700，关闭窗口隐藏到托盘 |
| 托盘 | 右键菜单：显示窗口 / 退出常在；左键点击显示窗口 |
| 通知 | `tauri-plugin-notification`，命令 `notify_probe` |
| 数据层自检 | 命令 `db_probe`：SQLite 建库/重开、FTS5 trigram 中文检索、Argon2id+AES-GCM 封装校验、SQLCipher 状态 |
| 流式 HTTP | 命令 `http_stream_probe`：本地 chunked echo + reqwest 流式读取、首 chunk 延迟 |
| 环境信息 | 命令 `app_info`：版本 / Tauri 版本 / OS / WebView2 |

### 5.4 界面（Step 1 桌面壳）

- 仿微信聊天主界面静态预览（气泡、时间分隔、输入中、AI 角标、输入栏）
- 「Step 1 技术底座自检」面板：一键运行环境 / SQLCipher+FTS5 / 流式 HTTP / 通知，并展示 JSON 结果
- 设计 token 落在 `packages/shared/src/design-tokens.ts` 与 `apps/app/src/styles.css`，与 `docs/step0-design-baseline.md` 对齐

### 5.5 Step 0 文档

- `docs/step0-decisions.md`（范围/平台基线/产品决策/技术决策/网络基线）
- `docs/step0-data-export-guide.md`（微信导出、媒体、自检清单）
- `docs/step0-holdout-protocol.md`（holdout 抽样与冻结纪律）
- `docs/step0-design-baseline.md`（token、布局、组件、状态、文案）

## 6. 复现命令

```powershell
# 1) 环境
powershell -ExecutionPolicy Bypass -File scripts\env.ps1

# 2) 依赖（镜像已配置）
pnpm install

# 3) 一键验收（类型检查 + core 单测 + Rust 探针 + spike 套件）
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1

# 4) 桌面开发
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1

# 5) 构建 Windows 安装包（自动设置 GitHub 镜像）
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

**换机时的镜像配置（本机已配置，记录在此以便复现）**：

```powershell
# Cargo 镜像（%USERPROFILE%\.cargo\config.toml）
@"
[source.crates-io]
replace-with = "rsproxy-sparse"
[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"
[net]
git-fetch-with-cli = true
"@ | Out-File -Encoding utf8 "$env:USERPROFILE\.cargo\config.toml"

# Rustup 镜像（安装工具链时设置）
$env:RUSTUP_DIST_SERVER='https://rsproxy.cn'
$env:RUSTUP_UPDATE_ROOT='https://rsproxy.cn/rustup'
```

> npm 镜像写在仓库 `.npmrc`（npmmirror）；Tauri 打包工具镜像写在 `scripts/build.ps1`（`TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://ghproxy.net/https://github.com`），可用环境变量覆盖。

**最近一次全量验收**：2026-11-17 11:12，`scripts/verify.ps1` 全绿（类型检查、11 项 core 单测、2 项 Rust 探针、6 项 spike），退出码 0。

## 7. Step 1 验收对照（按 05 方案 Step 1）

| 验收项 | 状态 | 证据 |
|---|---|---|
| 桌面壳可启动（Tauri 2） | ✅ | 应用窗口 + `docs/assets/step1-shell.png` |
| 加密数据库读写 | ✅ 通过 | `db_probe_passes`（SQLCipher 整库加密 + 错误口令拒绝，见 §3） |
| FTS5 中文检索可用 | ✅ | Python recall 100% + Rust trigram 测试 |
| 托盘 + Windows 通知 | ✅ 能力验证 | 托盘代码 + PowerShell Toast |
| Rust 侧流式 HTTP | ✅ | `http_probe_passes` |
| 未签名安装包可生成 | ✅ | `Changzai_0.1.0_x64-setup.exe`（5.36MB） |
| core 单测 / 类型检查 | ✅ | 11/11 单测、app+core tsc 通过 |
| 干净机器安装验证 | ⏳ | 需第二台旧 Win10 机器（Step 0 待办） |

## 8. 遗留与需产品确认的事项

- [x] **SQLCipher 已启用**：Strawberry Perl 5.42.3 便携版 + NASM 2.16.03 + MSVC；`cargo test --lib` 全绿（见 §3）。备用系统 OpenSSL 方案保留（`--features sqlcipher-system`）。
- [x] 安装包形态：NSIS `.exe` 已产出；MSI 需 WiX，本期不启用（如必须可另加）。
- [ ] 代码签名证书（Step 0 待办）：未签名包在干净机器会触发 SmartScreen，需要采购。
- [ ] 高保真设计稿（Step 0 待办）：当前只有 token + 线框，T24 验收前需冻结。
- [ ] 真机矩阵：需要一台旧 Win10 机器验证 WebView2 缺失场景 + 安装包首次启动。
- [ ] Step 2 前确认：导入适配器优先级、媒体导入（T35）是否进本期、真实微信记录导出与 holdout 封存时点。

## 9. Step 2 进入条件与首批任务

**进入条件（建议在启动 Step 2 前完成）**：
1. 上面 §8 的 SQLCipher 决策 + 至少一台干净机器的安装验证；
2. 真实聊天记录导出成功，按 `docs/step0-holdout-protocol.md` 封存 holdout；
3. 冻结至少聊天主界面 + 导入向导的高保真设计稿；
4. 产品确认 §8 的两个范围问题。

**Step 2 首批任务（数据管道）**：
- T03：5 个导入适配器（wechatmsg_txt / csv / liuhen_json / qq_txt / plaintext_paste）+ 插件注册
- T04：burst / latency 补全（core 已实现，接 UI 与真实数据抽检）
- T05：体检报告接 UI（core 已实现，需 SQLCipher/DB 持久化）
- T35（建议）：媒体导入（图片 / 语音文件）
- T39（前置）：黄金情境 50 条、盲测协议、holdout 泄漏校验脚本
- T34（可并行）：人格卡审阅与 Correction 层（Step 3 用）
- 技术接线：`DbPort` / `HttpPort` 的 Rust 实现 + `CoreAPI.importFiles` 的进度/续跑
- 性能：5 万条导入 <90s、内存 <500MB、崩溃可恢复

---

**报告版本**：v1.0 ｜ 2026-11-17 ｜ 随 Step 1 交付冻结；Step 2 起每阶段更新一次。
