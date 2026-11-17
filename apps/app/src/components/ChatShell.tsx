import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useChat, lastMessageOf, messagePreview } from "../hooks/useChat.ts";
import { useMediaImport } from "../hooks/useMediaImport.ts";
import { useProfile } from "../hooks/useProfile.ts";
import { useToast } from "../hooks/useToast.ts";
import { readChatImageFile } from "../lib/avatar.ts";
import { displayName } from "../lib/profile.ts";
import type { PersonProfile } from "../lib/profile.ts";
import type { ImportedMediaFile } from "../lib/tauri.ts";
import { ConversationList } from "./ConversationList.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { Composer, type ComposerAction } from "./Composer.tsx";
import { ImageLightbox, type PreviewImage } from "./ImageLightbox.tsx";
import { MessageList } from "./MessageList.tsx";
import { NavRail, type RailTab } from "./NavRail.tsx";
import { SettingsDrawer } from "./SettingsDrawer.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { Toast } from "./Toast.tsx";

/** 主界面：64px 导航 + 280px 会话列表 + 聊天区。 */
export function ChatShell(): ReactElement {
  const { profile, storageError, setName, setAvatar, reset } = useProfile();
  const { messages, typing, unread, sendText, sendImage, appendImported, markRead } = useChat();
  const { toast, show } = useToast();

  const [railTab, setRailTab] = useState<RailTab>("chat");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);

  const handleImported = useCallback(
    (files: ImportedMediaFile[]) => {
      appendImported(files);
      setRailTab("chat");
    },
    [appendImported],
  );
  const media = useMediaImport(handleImported);

  const her = useMemo<PersonProfile>(
    () => ({ name: displayName(profile.her, "她"), avatar: profile.her.avatar }),
    [profile.her],
  );
  const me = useMemo<PersonProfile>(
    () => ({ name: displayName(profile.me, "我"), avatar: profile.me.avatar }),
    [profile.me],
  );

  const last = lastMessageOf(messages);
  const previewText = typing ? "对方正在输入…" : messagePreview(last);
  const lastTs = last?.ts ?? Date.now();

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const handleSelectConversation = useCallback(() => {
    setRailTab("chat");
    markRead();
  }, [markRead]);

  const handleRailSelect = useCallback((tab: RailTab) => {
    setRailTab(tab);
    if (tab !== "chat") setSearch("");
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      sendText(text);
    },
    [sendText],
  );

  const handlePickImage = useCallback(
    (file: File) => {
      void (async () => {
        try {
          const dataUrl = await readChatImageFile(file);
          sendImage(dataUrl, file.name);
        } catch (error) {
          show(error instanceof Error ? error.message : "图片没有读取成功");
        }
      })();
    },
    [sendImage, show],
  );

  const handleUnavailable = useCallback(
    (action: ComposerAction) => {
      if (action === "file") show("暂不支持发送文件");
      else if (action === "screenshot") show("暂不支持截图");
      else show("暂不支持录制语音");
    },
    [show],
  );

  return (
    <div className="chat-shell">
      <NavRail me={me} active={railTab} onSelect={handleRailSelect} onOpenSettings={() => setSettingsOpen(true)} />

      {railTab === "chat" ? (
        <ConversationList
          herName={her.name}
          herAvatar={her.avatar}
          preview={previewText}
          ts={lastTs}
          unread={unread}
          search={search}
          onSearch={setSearch}
          onSelect={handleSelectConversation}
          onAdd={() => show("这里只有她一个人")}
        />
      ) : (
        <SidePanel tab={railTab} her={her} onOpenChat={handleSelectConversation} />
      )}

      <main className="chat-main">
        <ChatHeader her={her} typing={typing} onOpenSettings={() => setSettingsOpen(true)} />
        <MessageList messages={messages} her={her} me={me} typing={typing} onPreview={setPreview} />
        <Composer onSend={handleSend} onPickImage={handlePickImage} onUnavailable={handleUnavailable} />
      </main>

      {settingsOpen && (
        <SettingsDrawer
          onClose={closeSettings}
          profile={profile}
          storageError={storageError}
          onNameChange={setName}
          onAvatarChange={setAvatar}
          onReset={reset}
          media={media.state}
          canImport={media.canImport}
          onImport={media.importMedia}
        />
      )}

      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
      <Toast text={toast?.text ?? null} />
    </div>
  );
}
