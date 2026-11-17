# 常在 · Step 0 决策记录（PC 单端基线）

> 状态：Step 0 产出。默认值来自 `05-pc-only-execution-plan.md` §1.3；标「待确认」的需要产品最终拍板。
> 更新方式：在表格「状态」列改为「已确认」并写下日期/决定人。

- **默认称呼（2026-11-17 更新）**：系统默认称呼改为 **ta**，不再预设「小林」；用户可在设置里自行修改。旧版本已保存的「小林」在读取时自动迁移为 ta，不覆盖用户自定义名字。

## 1. 范围

| 项 | 决定 | 状态 |
|---|---|---|
| 本期形态 | Windows 桌面应用（聊天系统 + 其余全部产品功能） | 待确认 |
| 不做的端 | iOS / Android / 平板 / Web 公共站点 | 待确认 |
| 不做的能力 | 语音克隆（V2）、QQ/微信接入、云同步、账号、订阅/内购、社区 | 待确认 |
| 保留的能力 | F01–F17 全部（移动端本身除外）+ 补丁卡 T33–T46 | 待确认 |
| 未来补移动端 | 保留架构（core 纯 TS + 端口注入 + 数据版本号），预计 4–6 周 | 已确认（架构纪律） |

## 2. 平台基线

| 项 | 默认值 | 备注 | 状态 |
|---|---|---|---|
| 目标系统 | Windows 10 1809+ / Windows 11（x64） | 32 位与 ARM 不做 | 待确认 |
| 桌面框架 | Tauri 2 + WebView2 | Electron 仅在 Tauri 不可行时回退 | 已确认（Step 1 验证） |
| 安装包 | `.msi`（主）/ NSIS `.exe`（备） | 本轮先用 Tauri bundler 出包，签名后发布 | 待确认 |
| 数据目录 | `%APPDATA%\StillHere\` | DB / media / logs；卸载不自动删除 | 待确认 |
| 常驻形态 | 关闭窗口 → 托盘；设置可改为直接退出 | 主动消息的前提 | 待确认 |
| 开机自启 | 默认关闭，设置可开 | 打开后主动消息体验最好 | 待确认 |
| 自动更新 | 首版手动下载；V1.1 起自动更新 | 更新密钥离线保管 | 待确认 |
| 代码签名 | 购买 OV 证书（¥1–2k/年） | 否则 SmartScreen 拦截 | 待确认（采购） |
| macOS | 代码保持可构建，本期不出包 | 需 Apple 账号 + 公证 | 待确认 |

## 3. 产品决策（与 04 §8.3 对齐）

| # | 问题 | 默认建议 | 状态 |
|---|---|---|---|
| 1 | 图片/语音回忆进 MVP？ | 导入 + 查阅进 MVP；AI 理解放 V1.1 | 待确认 |
| 2 | 毕业/时长提醒放哪？ | MVP 含安全页 + 90 分钟提醒 + 危机资源；毕业信 V1.1 | 待确认 |
| 3 | 是否收费？ | 完全免费 + 自愿赞助，或官网买断；不做 iOS 内购 | 待确认 |
| 4 | 客户端开源？ | AGPL-3.0（数据与人格卡永不上传） | 待确认 |
| 5 | iOS 本期是否必须？ | 不需要（本期 PC 单端） | 已确认（范围） |
| 6 | 桌面主动消息形态？ | 托盘常驻 + 即时通知 + 启动补发 | 待确认 |
| 7 | 评测 ground truth？ | 产品负责人定标准 + 10–20 位内测用户 | 待确认 |
| 8 | 开发方式与预算？ | AI 代理编码 + 人工验收/评测/合规 | 待确认 |

## 4. 技术决策（Step 1 已验证/待验证）

| 项 | 决定 | 状态 |
|---|---|---|
| 包管理 | pnpm workspace（42 号机用 bundled pnpm 11） | 已确认 |
| Node | 20+（本机用 bundled Node 24） | 已确认 |
| 语言 | 全 TypeScript + Rust 宿主 | 已确认 |
| 数据库 | SQLite + **SQLCipher 整库加密**（默认 `sqlcipher-system`，链接预编译 OpenSSL 3.5；`env.ps1` 自动设置 `OPENSSL_DIR`） | ✅ Step 1 已验证 |
| 数据库（自包含备选） | `sqlcipher-vendored`：Strawberry Perl 5.42.3 + NASM 2.16.03 已安装；构建较慢，发布时可不依赖外部 OpenSSL DLL | ✅ 工具链已备 |
| 中文检索 | FTS5 trigram（unicode61 不可用，见 spike） | ✅ 已验证 |
| 全文索引同步 | external-content 表必须配 INSERT/UPDATE/DELETE 触发器 | ✅ 已验证 |
| 媒体 | 图片/语音导入进 MVP（T35）：Rust `import_media_files` + `media` 表 + dataUrl 预览 | ✅ UI 链路已实现，按 msg_id 入库待 Step 2 |
| 双方资料 | 昵称/头像自定义：Step 1 先 localStorage（key `changzai.profile.v1`）；`profile` 表 DDL 已就绪 | ✅ 计划内 |
| 模型接入 | OpenAI 兼容，Rust 侧请求（避开 CORS） | 待 Step 5 |
| Key 存储 | Windows 凭据管理器（keyring） | 待 Step 2 |
| 日志 | 本地脱敏，7 天轮转，不上传 | 待 Step 2 |

## 4.1 2026-11-17 产品/UI 变更（已确认）

| # | 变更 | 影响 |
|---|---|---|
| 1 | 聊天界面以**微信 Windows 桌面版**为基准：三栏布局、双方头像（她左/我右）、气泡配色、输入工具栏、会话列表 | `apps/app/src/**` UI 重做；参考 `docs/assets/step1-shell.png` |
| 2 | **移除每条消息的「AI」气泡角标**；改为在「设置 → 使用说明」与首启说明中披露 | ⚠️ 与 `01-competitor-and-compliance.md` §8「每条 AI 消息常驻标识」存在冲突；公开分发前需律师确认，或增加非侵入式标识（窗口标题/关于页常驻说明/导出水印） |
| 3 | **移除主界面的技术自检面板**；改为开发页 `#/dev` 或 `Ctrl+Shift+D` | 主界面保持干净；调试能力保留 |
| 4 | 图片/语音素材导入、双方昵称/头像自定义 | 已进 MVP 范围；Step 2 接真实聊天记录媒体 |
| 5 | 多人协作：GitHub 仓库 + `main` 保护 + PR 流程 + CI | 见 `CONTRIBUTING.md` 与仓库 `.github/` |

## 5. 本机网络基线（影响构建）

| 项 | 值 |
|---|---|
| npm registry | `https://registry.npmmirror.com`（`.npmrc`） |
| Cargo 镜像 | `sparse+https://rsproxy.cn/index/`（全局 `~/.cargo/config.toml`） |
| Rustup 镜像 | `RUSTUP_DIST_SERVER=https://rsproxy.cn` |
| GitHub release 资产 | 直连超时；用 `gh-proxy.com` / `ghproxy.net` 代理（Tauri 打包与 Strawberry Perl 下载均已验证） |
| 直连受限 | `registry.npmjs.org` / `crates.io` / `static.crates.io` 超时；GitHub 页面可访问 |

## 6. 待办（Step 0 剩余）

- [ ] 采购 Windows OV 代码签名证书（1–2 周）
- [ ] 用真实微信记录完成一次导出，确认文字/图片/语音可得性（见 `step0-data-export-guide.md`）
- [ ] 冻结高保真设计稿（聊天壳 / 引导 / 设置），当前按微信桌面版重做中
- [ ] 建立 holdout 并封存（见 `step0-holdout-protocol.md`）
- [ ] 确认上表所有「待确认」项
- [ ] 邀请协作者并为 `main` 配置分支保护（见 `CONTRIBUTING.md`）
