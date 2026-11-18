# V2.1 语音朗读（TTS）方案与进度

- 日期：2026-11-18
- 状态：开发中（Windows 本机 TTS 已接通）
- 目标：让 ta 的文字回复可以朗读，默认关闭，不改变聊天内容

## 1. TTS 需不需要云端 API？

分三种情况：

| 目标 | 是否需要云 API | 说明 |
|---|---|---|
| 只要能朗读，音色机器人也能接受 | **不需要** | Windows 自带 SAPI，本机离线，免费 |
| 要自然、稳定的中文音色 | **需要** | OpenAI / Azure / 火山等云 TTS，需要 Key、按量计费 |
| 要“上传对方音频，变成她的声音” | **必须用支持声音克隆的服务，或本地模型** | 普通 TTS 做不到；ElevenLabs/Azure 自定义音色要 Key；本地 GPT-SoVITS/CosyVoice 要 GPU/模型 |

所以结论不是“TTS 一定要云 API”，而是：

- **基础朗读：不需要云 API**；
- **自然音色：建议云 TTS**；
- **声音克隆：V2.1 不做**，放到后续版本。

## 2. V2.1 本轮选择

### 默认：Windows 本机 SAPI

- 不需要 API Key；
- 不需要联网；
- 系统自带中文音色（例如 `Microsoft Huihui Desktop`）；
- 音色偏机械，但可以立即用、隐私最好。

### 可选：OpenAI 兼容云 TTS

- 用户自己填 Base URL / API Key / 模型 / 音色；
- 调用 `POST {baseUrl}/audio/speech`；
- 更自然，但会把朗读文本发给服务商，并产生费用；
- 需要用户在设置里明确开启。

### 暂不做

- 声音克隆 / 上传音频变声；
- 实时语音通话；
- 后台常驻麦克风；
- Edge TTS 非官方接口（先不把稳定性押在它上面）。

## 3. 交互

- 每个聊天独立保存 `VoiceSettings`：
  - 是否启用；
  - 是否自动朗读新回复；
  - 本机/云 TTS；
  - 音色、语速、云 Key。
- 默认关闭；关闭时不显示朗读按钮、不调用 TTS。
- 开启后：
  - ta 的文字气泡出现小喇叭，点击朗读；
  - 可打开“自动朗读新回复”；
  - TTS 失败只提示，不影响文字；
  - 安全/危机提示不自动朗读。
- 音频只在内存中播放，不写入聊天记录；避免数据库膨胀。

## 4. 技术实现

- Rust `tts.rs`：
  - `tts_speak`：Windows SAPI → WAV → base64；或 OpenAI 兼容 `/audio/speech` → MP3 → base64；
  - `tts_voices`：列出 Windows 已安装音色；
  - PowerShell 仅作为 Windows SAPI 的调用壳，文本通过临时文件/环境变量传递，避免命令注入。
- 前端：
  - `useTts`：合成、播放、停止、错误；
  - `TextBubble`：朗读按钮；
  - `SettingsDrawer`：语音来源、音色、语速、自动朗读、试听；
  - 会话设置沿用 `conversations.v1` 的 `settings.voice`。

## 5. 验收

- [x] Rust `cargo check` 通过；
- [x] 前端 `tsc --noEmit` 通过；
- [x] Windows 本机中文 TTS 实际试听（本地 `cargo test ... --ignored` 通过）；
- [ ] 切换聊天后语音设置独立（代码已按会话存储，待人工验收）；
- [ ] 云 TTS 用测试 Key 试听（可选）；
- [ ] 自动朗读只在开启时发生；
- [ ] 安全提示不朗读。

## 6. 后续

- V2.2：STT 语音输入（麦克风按住说话 → 转写 → 确认发送）；
- V2.2+：声音克隆（云服务或本地 GPT-SoVITS/CosyVoice）；
- 虚拟形象 / Live2D 桌宠另开版本，不与 TTS 耦合。
