# V2.3 MVP：透明桌宠（静态形象 + Live2D）

- 日期：2026-11-19
- 状态：桌面桌宠主功能完成；Live2D 模型可导入
- 目标：透明桌宠窗口、图片/Live2D 双模式、快捷聊天、状态和位置记忆

## 已实现

- Tauri 独立 `pet` 窗口：无边框、透明、置顶、跳过任务栏、默认关闭；
- 图片桌宠：
  - 每个聊天独立图片；
  - 上传时正方形裁剪（512×512，透明 PNG 保留）；
  - 完整模式 200×200，Mini 150×150；
- Live2D：
  - 设置中选择 Cubism 4 模型文件夹或 .zip；支持 zip 内多个模型时选择角色；
  - 模型文件存 IndexedDB，不上传；
  - `pixi-live2d-display` + Cubism Core 本地渲染；
  - 模型可在完整模式和 Mini 模式下缩放显示；
- 拖动、位置保存；
- 单击弹出快捷聊天；双击打开聊天；右键菜单；
- 快捷文字/语音、快捷回复、状态（在线/在想/刚回完）；
- Mini 模式、托盘显示/隐藏、专属图片、头像裁剪；
- 主窗口通过 localStorage 同步当前聊天状态。

## Live2D 使用要求

- 当前支持 Cubism 4 的 `.model3.json` 模型；
- 用户必须拥有模型使用授权；
- Cubism Core 运行时随应用本地提供，不需要云 API；
- 模型文件夹不打包进安装包，由用户自行导入。

## 暂未完成

- 自动抠图/Q版化（一张图生成可动纸片人）；
- Live2D 动作/表情选择面板、TTS 口型；
- 鼠标穿透、多屏边界限制；
- 性能/多 DPI 长期测试；
- Cubism 2 模型；
- 用户模型版权校验。

## 文件

- `apps/app/pet.html`
- `apps/app/src/pet.ts`
- `apps/app/src/pet.css`
- `apps/app/src/lib/live2d.ts`
- `apps/app/src/lib/live2dStore.ts`
- `apps/app/src/components/Live2DImport.tsx`
- `apps/app/src-tauri/src/pet.rs`
- `apps/app/src-tauri/capabilities/pet.json`
