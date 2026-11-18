# V2.3 MVP：透明桌宠（静态形象）

- 日期：2026-11-18
- 状态：第一版可运行（静态头像）
- 目标：先用最小实现验证桌宠窗口、拖动、位置记忆、点击/双击/右键和聊天状态同步

## 已实现

- Tauri 独立 `pet` 窗口：
  - 无边框、透明背景、置顶、跳过任务栏；
  - 默认关闭，从「聊天设置 → 桌宠」打开/关闭；
  - 260×320，不可缩放。
- 使用当前聊天头像作为桌宠图片；
  - 没有头像时显示名字首字占位。
- 拖动窗口；
- 拖动后位置写入 `setting pet.position`，下次打开恢复；
- 单击：随机冒一句本地气泡（不调用 LLM）；
- 双击：显示并聚焦主聊天窗口；
- 右键：打开聊天 / 隐藏桌宠 / 关闭桌宠；
- 主窗口把当前聊天状态写入 `localStorage["pet.state"]`：
  - 她的名字、头像、最后一条消息、时间；
- 切换聊天或收到新消息时，桌宠头像和气泡同步；
- 隐藏/关闭不影响聊天和人格。

## 文件

- `apps/app/pet.html`
- `apps/app/src/pet.ts`
- `apps/app/src/pet.css`
- `apps/app/src-tauri/src/pet.rs`
- `apps/app/src-tauri/capabilities/pet.json`
- `apps/app/vite.config.ts`（多页面入口）
- `ChatShell` / `SettingsDrawer` 接入

## Live2D 需要用户上传什么

Live2D 不是一张图片，通常需要：

```text
模型文件夹/
  model.model3.json      # 入口
  model.moc3             # 模型
  textures/*.png         # 贴图
  model.physics3.json    # 物理（可选）
  model.pose3.json       # 姿势（可选）
  motions/*.motion3.json # 动作（可选）
  expressions/*.exp3.json# 表情（可选）
```

一般导入整个文件夹或 zip；必须有 `.model3.json` 和 `.moc3`，贴图路径要相对模型正确。

### 简单图片可以吗

可以。当前 MVP 就是用普通图片（PNG/WebP，建议透明背景）做静态桌宠。  
图片模式没有 Live2D 的呼吸、眨眼、动作和口型，但能先完成桌宠窗口、拖动、点击、位置记忆和聊天同步。

### 需要调用其它 API 吗

Live2D 渲染本身**不需要云 API**：

- 需要 Live2D Cubism Core 运行时（本地）；
- 需要 `pixi-live2d-display` 之类的渲染层；
- 需要用户自备且有权使用的模型素材；
- TTS/STT/LLM 仍是原有可选能力，和 Live2D 解耦。

不能直接内置视频里的大肥鱼模型，模型版权归原作者/权利人。

## 下一步

- 静态图片导入/裁剪（专用桌宠图，而不是只复用聊天头像）
- Live2D 模型导入（文件夹/zip）
- 待机动作、点击动作、说话口型
- 鼠标穿透/置顶开关
- 隐藏/最小化暂停渲染，待机 CPU 验收
- 多屏/DPI 测试
