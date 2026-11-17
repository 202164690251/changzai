## 这个 PR 做了什么

<!-- 一句话说明；关联 Issue：Closes #123 -->

## 改动范围

- [ ] UI（附截图）
- [ ] core / shared
- [ ] Rust（Tauri / SQLCipher / 媒体）
- [ ] 文档 / 工程配置

## 验证方式（必填）

```powershell
# 贴出实际执行的命令与结果，例如：
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
# 结果：全部验收项通过 ✅（或说明哪项未跑/失败）
```

- [ ] `scripts\verify.ps1` 通过（或说明未跑原因）
- [ ] UI 改动附前后截图（1280×800）
- [ ] 已自测：导入 / 聊天 / 设置 / 素材导入（按改动范围勾选）

## 检查清单

- [ ] 没有提交真实聊天记录、图片/语音、头像、数据库、API Key 或个人信息
- [ ] 新增/修改数据结构已同步 `packages/shared/src/types.ts`
- [ ] core 未引入 `window/fs/fetch/localStorage`
- [ ] 更新了相关文档（README / docs / CONTRIBUTING）
- [ ] 没有把调试代码、临时文件、`release/` 产物带进 PR

## 其他说明

<!-- 风险、兼容性、后续 TODO -->
