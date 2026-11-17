# Step 2 · 数据管道与多人协作计划

> 起点：Step 0/1 已完成，主界面已按微信桌面版重做，SQLCipher 已启用。
> 目标：**导入真实聊天记录 → 5 万条 <90s → 体检报告 → 30 秒可聊**；同时把「图片/语音素材」「双方资料」从 UI 演示落到数据库。

## 1. 里程碑

| 里程碑 | 交付 | 验收 |
|---|---|---|
| S2-1 导入可用 | 5 个适配器 + 导入向导 + 进度/续跑 + 体检报告接 UI | 3 种格式各 1000 条无异常；5 万条 <90s；报告字段齐全 |
| S2-2 媒体落库 | `media` 表 + 按 `msg_id` 关联 + 聊天内展示 | 图片/语音可展示/播放；过期媒体有提示 |
| S2-3 资料落库 | `profile` 表 + 双方昵称/头像持久化 | 重启后昵称/头像仍在；导出/导入不丢 |
| S2-4 评测前置 | holdout 校验 + 黄金集 50 + `pnpm eval` 最小版 | holdout 不泄漏；改 Prompt 可回归 |
| S2-5 收尾 | Tauri 安装包内置 OpenSSL DLL；CI 全绿；首批内测 | 干净 Win10/11 安装即用；CI `web`+`rust` 通过 |

## 2. 任务拆分（建议分支）

| 任务 | 内容 | 建议分支 | 主要文件 |
|---|---|---|---|
| T03 | 5 个导入适配器（wechatmsg_txt/csv、liuhen_json、qq_txt、plaintext_paste） | `feat/ingest-adapters` | `packages/core/src/ingest/adapters/**` |
| T04 | burst/latency 接真实数据与抽检脚本 | `feat/ingest-signals` | `packages/core/src/ingest/burst.ts` |
| T05 | 体检报告接 UI（导入向导第 3 屏） | `feat/ingest-report-ui` | `apps/app/src/**` + CoreAPI |
| T34 | 人格卡审阅 + Correction 层 | `feat/persona-correction` | `packages/core/src/persona/**` |
| T35 | 媒体按 `msg_id` 入库（Rust/DB） | `feat/media-persist` | `src-tauri/src/media.rs`、`core/media/**` |
| T39 | holdout 校验 + 黄金集 + `pnpm eval` | `feat/eval-harness` | `scripts/`、`packages/core/test/` |
| S2-3 | `profile` 表落库替换 localStorage | `feat/profile-persist` | `src-tauri`、`packages/core`、UI 设置页 |
| 打包 | 安装包内置 OpenSSL DLL（NSIS hook / vendored） | `chore/openssl-bundle` | `tauri.conf.json`、`src-tauri/installer` |

> 并行建议：T03/T04 与 T39 可并行；T35 依赖 T03 的消息 ID；S2-3 可在 T05 后做；打包与主流程最后做。

## 3. 接口与数据约定（先改这里再改实现）

- 数据结构：`packages/shared/src/types.ts`（已有 `NormalizedMessage`、`MediaFile`、`Profile`、`MediaRecord`）。
- 数据库：`packages/core/src/db/ddl.ts`（v2，含 `media` / `profile`）；改动必须递增 `SCHEMA_VERSION` 并写迁移说明。
- Rust 命令：`apps/app/src-tauri/src/media.rs`（`import_media_files`，返回 camelCase）。
- UI 不直接操作 DB；Step 2 起走 `DbPort` 实现 + `CoreAPI`。

## 4. 协作方式（详见 CONTRIBUTING.md）

1. 认领 Issue → 从 `main` 拉 `feat/<scope>-<short>`；
2. 小步提交（Conventional Commits）；PR 用模板填「验证方式 + 截图」；
3. CI 必须 `web` + `rust` 全绿；至少 1 人 review；Squash merge；
4. 不提交真实聊天记录/头像/API Key；测试用合成数据；
5. main 合并后作者在 Issue 写验证结论，并删除远端分支。
