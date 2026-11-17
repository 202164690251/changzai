# Step 3 · 人格卡与真实对话进度（2026-11-17）

> 目标：**导入记录 → 生成 ta 的人格卡 → 用真实模型以 ta 的口吻聊天**。
> 本期先完成「人格卡 + prompt + 模型接入 + 流式回复」的纵切面；情绪标注、Correction UI、黄金集评测留到下一批。

## 已完成

| 模块 | 内容 | 验证 |
|---|---|---|
| 默认称呼 | 系统默认从「小林」改为 **ta**；用户可自行修改；旧 localStorage/DB 里的「小林」读取时自动迁移为 ta | 旧数据启动后显示 ta |
| 人格卡构建（纯 TS） | 从她的非 holdout 文字消息统计：平均句长、短句/问句/表情/感叹/省略号/夜间占比、语气词、高频短语；抽取「喜欢/不喜欢/在做/住在/工作/养了/害怕」事实；取样参考对话；按天聚 episode；固定安全边界 | `packages/core/test/persona.test.ts` 8 项全过 |
| prompt 构建 | system prompt = 身份与边界 + 风格卡 + 事实 + 参考对话；`buildChatMessages` 负责历史角色映射与字符预算裁剪 | 同上 |
| 人格卡持久化 | `persona_save/load` 写 SQLCipher `setting` 表；导入后自动生成；设置页可「从已有消息重建」 | Rust 7 项测试 + UI 手动 |
| 模型配置 | 任意 OpenAI 兼容 Base URL / 模型 / API Key / 温度；存 SQLCipher `setting`，不进 localStorage | `llm_config_save/load` |
| 流式对话（Rust） | `llm_chat_stream` 用 reqwest + SSE，通过 Tauri Channel 逐字推给前端；包含错误/空回复处理 | Rust 本地 mock SSE 端到端测试 |
| 聊天接入 | 已生成人格卡 + 配置模型 → 真实流式回复；只有人格卡没配置 → 提示去设置；都没有 → 保留 Step 1 演示回复 | Tauri dev 启动 + tsc/build |
| 默认资料迁移 | 旧默认「小林」→ ta；用户自定义名字不覆盖 | 代码 + 启动截图 |

## 验证数字

- core 单测：**37 项**（Step 2 的 29 + persona 8）
- Rust：**8 项**（SQLCipher 探针、store roundtrip、未初始化报错、流式 HTTP、LLM 配置/SSE 等）
- `tsc --noEmit` 0 错误；`vite build` 成功
- `scripts\verify.ps1` 全部通过 ✅（以最终运行结果为准）

## 已知限制 / 下一步

- [ ] 情绪标注 + Kappa 校准（Step 3 评测前置）
- [ ] 人格卡审阅/编辑 UI（当前只展示摘要，不能逐条确认事实）
- [ ] Correction 层（用户纠正「ta 不会这样说」）
- [ ] holdout 黄金集回归 + 泄漏检查脚本（当前 holdout 已排除出人格卡）
- [ ] 流式回复的「停止生成」、重试、多轮上下文窗口管理
- [ ] 多模型切换与费用提示
- [ ] 真实 5 万条数据下的 prompt 体积/延迟实测
- [ ] 安装包内置 OpenSSL DLL（portable 已带）

## 手动测试

1. `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1`
2. 设置 → 数据 → 导入 `examples/wechat-sample.txt` + `examples/liuhen-sample.json`
3. 设置 → 模型：填 DeepSeek/OpenAI 兼容的 Base URL、模型名、API Key → 保存
4. 回到聊天，发一句；应看到 ta 逐字回复
5. 设置 → 人格卡：查看摘要/事实/样例，或点「从已有消息重建」

> API Key 只写入本机 SQLCipher；但当前版本把它当普通 setting 存整库加密，Step 6 会改为 Windows 凭据管理器单独托管。
