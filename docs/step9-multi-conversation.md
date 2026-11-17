# 多会话 / 新聊天 / 搜索 / 清空删除

- 日期：2026-11-18
- 版本：V2.0.1
- 范围：左侧会话列表、创建新聊天、微信式搜索、清空/删除

## 已完成

### 1. 左侧多会话列表

- 每个聊天有独立 `ConversationRecord`：
  - id、标题、她的名字/头像；
  - 人格卡 JSON；
  - 关系卡 JSON；
  - 问候语、最后一条预览、时间；
- 会话列表存 SQLCipher 的 `conversations.v1` 设置；
- 当前会话 id 存 `conversations.active`；
- 首次升级旧数据：自动创建 `default` 会话，旧 `chat_message`（没有 `convId`）继续归入 default。

### 2. 「+」创建新聊天

- 左侧搜索框右侧 `+` 打开 PersonaStart；
- 三选一：
  - 从聊天记录创建；
  - 选一个性格（8 模板）；
  - 自己写一个；
- 新聊天不会覆盖旧聊天；
- 创建后写入独立会话记录、人格、关系、问候消息，并切换到新聊天。

### 3. 消息按会话隔离

- `chat_message.payload` 增加 `convId`；
- 加载时按 `convId` 过滤；
- 切换会话时重新加载对应消息；
- 发送、回复、主动消息、导入素材、撤回/删除都带当前会话 id；
- 旧消息无 `convId` 归 default。

### 4. 搜索

- 搜索框支持：
  - 聊天标题/她的名字；
  - 聊天记录文本（从 `chat_message` 读取最近 2000 条）；
- 结果显示：
  - 「聊天」：匹配的会话；
  - 「聊天记录」：匹配消息，显示聊天标题、发送者、文本、时间；
- 点击结果切换到对应聊天；
- 搜索不改变当前聊天内容。

### 5. 右键菜单

- 会话右键：
  - **清空聊天记录**：确认后删除该会话消息，保留聊天和人格；
  - **删除聊天（不可恢复）**：两次确认后删除该会话全部消息和会话记录；
- 删除当前会话后：
  - 若还有其它聊天，自动切到第一个；
  - 若没有，回到空状态，可用 `+` 新建。

'## 6. 每个聊天的独立设置

- 会话记录增加 `settings`：
  - 模型配置（provider/baseUrl/model/fastModel/apiKey/temperature）；
  - 主动消息状态/预算/免打扰/秒级频率；
  - 情绪状态与手动状态覆盖；
  - 风格校准开关与反馈列表。
- 切换聊天时保存当前聊天设置，加载目标聊天设置；
- 当前聊天改动通过同步 effect 写回 `conversations.v1`；
- 人格、关系、消息、标题/头像本来就是每聊天独立；
- 安全/备份/全局统计仍是全局设置。

## 文件'

- `apps/app/src/hooks/useConversations.ts`
- `apps/app/src/components/ConversationList.tsx`
- `apps/app/src/components/ChatShell.tsx`
- `apps/app/src/hooks/useChat.ts`（convId 过滤/持久化）
- `apps/app/src/hooks/usePersona.ts`、`useRelationship.ts`（切换时 replace）
- `apps/app/src/styles.css`（搜索/菜单）

## 验证

- `tsc --noEmit` 通过；
- `vite build` 通过；
- 完整 `scripts/verify.ps1` 通过；
- 待人工验收：
  - 新建第二个聊天，左侧出现两项；
  - 切回旧聊天消息仍在；
  - 搜索命中消息；
  - 清空只影响当前项；
  - 删除需两次确认。

## 已知限制

- 会话元数据存 setting JSON，不是独立表；会话很多时性能会下降；
- 搜索只加载最近 2000 条消息，更早消息不参与搜索；
- 搜索结果点击后不会自动滚动到那条消息，只切换到对应聊天；
- 当前没有未读数/置顶/免打扰的每会话独立设置；
- 旧消息没有 convId 全部归 default；无法自动拆分到多个旧会话。
