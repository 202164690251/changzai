import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useChat, lastMessageOf, messagePreview } from "../hooks/useChat.ts";
import { useAnalytics } from "../hooks/useAnalytics.ts";
import { useDatabase } from "../hooks/useDatabase.ts";
import { useEmotion } from "../hooks/useEmotion.ts";
import { useImport } from "../hooks/useImport.ts";
import { useLlmConfig } from "../hooks/useLlmConfig.ts";
import { useMediaImport } from "../hooks/useMediaImport.ts";
import { usePersona } from "../hooks/usePersona.ts";
import { useProfile } from "../hooks/useProfile.ts";
import { useToast } from "../hooks/useToast.ts";
import { readChatImageFile } from "../lib/avatar.ts";
import { displayName } from "../lib/profile.ts";
import type { PersonProfile } from "../lib/profile.ts";
import type { ImportedMediaFile } from "../lib/tauri.ts";
import { api } from "../lib/tauri.ts";
import { ConversationList } from "./ConversationList.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { Composer, type ComposerAction } from "./Composer.tsx";
import { ImageLightbox, type PreviewImage } from "./ImageLightbox.tsx";
import { ImportWizard } from "./ImportWizard.tsx";
import { MessageList } from "./MessageList.tsx";
import { NavRail, type RailTab } from "./NavRail.tsx";
import { SettingsDrawer } from "./SettingsDrawer.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { Toast } from "./Toast.tsx";

/** 主界面：64px 导航 + 280px 会话列表 + 聊天区。 */
export function ChatShell(): ReactElement {
  const db = useDatabase();
  const llm = useLlmConfig();
  const persona = usePersona();
  const emotion = useEmotion();
  const analytics = useAnalytics();
  const { profile, storageError, setName, setAvatar, reset } = useProfile(db.ready);
  const { toast, show } = useToast();
  const { messages, typing, unread, sendText, sendImage, appendImported, clear, markRead } = useChat({
    persona: persona.profile,
    llm: llm.config,
    herName: displayName(profile.her, "ta"),
    meName: displayName(profile.me, "我"),
    emotion: emotion.state,
    onEmotion: emotion.update,
    onNotice: show,
  });

  const [railTab, setRailTab] = useState<RailTab>("chat");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const importer = useImport(async (result) => {
    await db.refresh();
    await persona.buildFromImport(result.messages);
    void api.memoryRebuild().catch(() => undefined);
    analytics.log("import_done");
    show("人格卡已生成，可以在设置里查看");
  });

  const loggedOpen = useRef(false);
  useEffect(() => {
    if (!db.ready || loggedOpen.current) return;
    loggedOpen.current = true;
    analytics.log("app_open");
  }, [analytics, db.ready]);

  const loggedFirst = useRef(false);

  // 已有消息但记忆为空时（老版本升级）自动重建一次
  useEffect(() => {
    if (!db.ready || !db.stats?.ok || db.stats.messageCount === 0) return;
    void (async () => {
      try {
        const count = await api.memoryCount();
        if (count === 0) await api.memoryRebuild();
      } catch {
        /* 记忆不可用不影响聊天 */
      }
    })();
  }, [db.ready, db.stats?.messageCount]);

  const clearedDemo = useRef(false);
  useEffect(() => {
    if (!clearedDemo.current && persona.profile !== null && persona.profile.source.her_messages > 0) {
      clearedDemo.current = true;
      clear();
    }
  }, [clear, persona.profile]);

  const openImport = useCallback(() => {
    importer.reset();
    setImportOpen(true);
  }, [importer]);

  const closeImport = useCallback(() => {
    setImportOpen(false);
    importer.reset();
  }, [importer]);

  const handleImported = useCallback(
    (files: ImportedMediaFile[]) => {
      appendImported(files);
      setRailTab("chat");
    },
    [appendImported],
  );
  const media = useMediaImport(handleImported);

  const her = useMemo<PersonProfile>(
    () => ({ name: displayName(profile.her, "ta"), avatar: profile.her.avatar }),
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
      analytics.log("message_me");
      if (!loggedFirst.current) {
        loggedFirst.current = true;
        analytics.log("first_message");
      }
      sendText(text);
    },
    [analytics, sendText],
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
          onAdd={() => show("这里只有 ta 一个人")}
        />
      ) : (
        <SidePanel tab={railTab} her={her} onOpenChat={handleSelectConversation} />
      )}

      <main className="chat-main">
        <ChatHeader her={her} typing={typing} onOpenSettings={() => setSettingsOpen(true)} />
        {messages.length === 0 && persona.profile !== null && (
          <div className="chat-ready-hint">已生成 ta 的人格卡，发一句试试。</div>
        )}
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
          dbStats={db.stats}
          dbReady={db.ready}
          dbError={db.error}
          onOpenImport={openImport}
          llmConfig={llm.config}
          llmStatus={llm.message}
          onSaveLlm={(config) => {
            void llm.save(config);
          }}
          persona={persona.profile}
          personaBusy={persona.busy}
          personaMessage={persona.message}
          onRebuildPersona={() => {
            void persona.rebuildFromDb();
          }}
          emotion={emotion.state}
          analyticsCounts={analytics.counts}
          analyticsTotal={analytics.total}
          onClearAnalytics={analytics.clear}
        />
      )}

      <ImportWizard
        open={importOpen}
        state={importer.state}
        canImport={importer.canImport}
        dbStats={db.stats}
        onRun={importer.run}
        onReset={importer.reset}
        onClose={closeImport}
      />

      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
      <Toast text={toast?.text ?? null} />
    </div>
  );
}
