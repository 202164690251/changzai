# 示例聊天记录（合成数据，可安全提交/测试）

这里是与真实微信/QQ 无关的**合成数据**，用于手动测试导入向导与自动化测试，不含任何隐私。

## 文件

| 文件 | 格式 | 说明 |
|---|---|---|
| `wechat-sample.txt` | WeChatMsg / 留痕 txt | 时间 + 发送人 + 多行正文 |
| `wechat-sample.csv` | WeChatMsg csv | 中英文表头，含 `IsSender` |
| `liuhen-sample.json` | 留痕 json | `messages` 数组 + `CreateTime/IsSender/StrContent` |
| `qq-sample.txt` | QQ txt | `昵称(QQ号)` + 多行正文 |

## 怎么用

1. 启动桌面应用（`scripts\dev.ps1` 或 `release\changzai.exe`）；
2. 打开左下角设置 → **数据 → 导入聊天记录**；
3. 在文件选择框里选择本目录的 1–4 个文件（可多选）；
4. 查看体检报告，确认写入 SQLCipher；看板会显示消息条数/她的条数/holdout 条数。

> 建议一次选多个文件，可验证跨文件去重与 holdout 切分。
