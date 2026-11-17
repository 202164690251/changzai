# Step 2 · 数据管道进度（2026-11-17）

> 目标：**导入真实聊天记录 → 解析/去重/体检 → 写入 SQLCipher → 可复现的 holdout**。
> 代码位置：`packages/core/src/ingest/**`、`apps/app/src-tauri/src/store.rs`、`apps/app/src/**`、`examples/`。

## 已完成

| 模块 | 内容 | 验证 |
|---|---|---|
| 导入适配器（6 种） | `wechatmsg_txt` / `wechatmsg_csv` / `liuhen_json` / `qq_txt` / `plaintext_paste` / `chatdata_js`；CSV 引号解析、文件编码由 Rust 处理（UTF-8/GB18030） | `packages/core/test/import-pipeline.test.ts` 10 项 + `chatdata-adapter.test.ts` 3 项全过 |
| 导入流水线 | 嗅探→解析→归一化→跨文件去重→burst/latency 补全→holdout 切分→体检报告；全程纯 TS | 同上 |
| holdout | 固定种子随机抽她的文字回复（默认 400，数据少按 5%、最少 20），`is_holdout=1` 入库 | 单测覆盖确定性 |
| SQLCipher 数据层 | `db_init(ddl)`、`import_persist`、`db_stats`、`profile_save/load`、`media_persist`、`pick_import_files`；DB 位于 app data，整库加密 | `cargo test --lib` 4/4（含持久化/统计/资料 roundtrip） |
| 前端导入向导 | 设置 → 数据 → 导入聊天记录；选文件→解析→体检报告→写入；展示总数/她的条数/跨度/夜间比/平均句长/还原度/缺失/识别文件/警告 | `tsc --noEmit` + `vite build` 通过 |
| 双方资料落库 | 昵称/头像写 `profile` 表（localStorage 双写作为浏览器 fallback） | Rust roundtrip 测试 |
| 媒体落库 | 回忆素材导入后写 `media` 表（按 msg_id 关联真实聊天媒体待 Step 3） | Rust media 写入测试 |
| 示例数据 | `examples/` 4 份合成聊天文件（无隐私），用于手动测试导入 | 可直接在桌面应用选择导入 |
| 全量验收 | `scripts\verify.ps1` | 全部通过 ✅ |

## 验证数字（本机 2026-11-17）

- core 单测：**29 项**（ingest 11 + media 8 + import-pipeline 10）
- Rust：**4 项**（SQLCipher 探针、数据层 roundtrip、未初始化报错、流式 HTTP）
- 前端：`tsc --noEmit` 0 错误、`vite build` 成功
- `scripts\verify.ps1` 退出码 0

## 已知限制 / 下一步

- [ ] **5 万条真实数据性能实测**（需你的真实导出文件；当前示例与单测数据都小）
- [ ] 长解析的**进度展示与断点续跑**（当前是同步解析 + 单次写入；失败需重新选文件）
- [ ] 媒体按 `msg_id` 关联真实聊天记录（当前 media 表存的是独立素材）
- [ ] 人格蒸馏、人格卡审阅、Correction 层（Step 3）
- [ ] DB key 目前是 app data 下的 `db.key` 文件，Step 6 接 Windows 凭据管理器
- [ ] 安装包内置 OpenSSL DLL（当前 portable 已带，NSIS 未打包）
- [ ] 导入向导的 1024×700 小窗布局需要再做一次视觉验收

## 手动测试步骤

1. `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1`
2. 左下角设置 → 数据 → 导入聊天记录
3. 选择 `examples/wechat-sample.txt`、`examples/liuhen-sample.json`（可多选）
4. 看体检报告 → 完成；重新打开应用，设置里应仍显示“已导入 N 条”
