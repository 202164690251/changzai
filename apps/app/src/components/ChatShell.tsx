import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { buildCustomPersona, buildCustomRelationship, buildPresetPersona, buildPresetRelationship, type CustomPersonaForm, type PersonaPreset, type PersonaProfile, type RelationshipProfile } from "@changzai/core";
import { useChat, lastMessageOf, messagePreview, type ChatMsg } from "../hooks/useChat.ts";
import { useAnalytics } from "../hooks/useAnalytics.ts";
import { useDatabase } from "../hooks/useDatabase.ts";
import { useEmotion } from "../hooks/useEmotion.ts";
import { useRelationship } from "../hooks/useRelationship.ts";
import { useStyleFeedback } from "../hooks/useStyleFeedback.ts";
import { useImport } from "../hooks/useImport.ts";
import { useLlmConfig } from "../hooks/useLlmConfig.ts";
import { useMediaImport } from "../hooks/useMediaImport.ts";
import { useOnboarding } from "../hooks/useOnboarding.ts";
import { usePin } from "../hooks/usePin.ts";
import { usePersona } from "../hooks/usePersona.ts";
import { useProactive } from "../hooks/useProactive.ts";
import { useConversations, type ConversationRecord } from "../hooks/useConversations.ts";
import { useProfile } from "../hooks/useProfile.ts";
import { useToast } from "../hooks/useToast.ts";
import { readChatImageFile } from "../lib/avatar.ts";
import { displayName } from "../lib/profile.ts";
import type { PersonProfile } from "../lib/profile.ts";
import type { ImportedMediaFile } from "../lib/tauri.ts";
import { api } from "../lib/tauri.ts";
import { ConversationList, type ConversationSearchResults } from "./ConversationList.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { Composer, type ComposerAction } from "./Composer.tsx";
import { ImageLightbox, type PreviewImage } from "./ImageLightbox.tsx";
import { ImportWizard } from "./ImportWizard.tsx";
import { MessageList } from "./MessageList.tsx";
import { NavRail, type RailTab } from "./NavRail.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { PersonaStart } from "./PersonaStart.tsx";
import { MemoryModal } from "./MemoryModal.tsx";
import { MoodPanel } from "./MoodPanel.tsx";
import { StyleReviewModal } from "./StyleReviewModal.tsx";
import { LockScreen } from "./LockScreen.tsx";
import { SettingsDrawer } from "./SettingsDrawer.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { Toast } from "./Toast.tsx";

/** 主界面：64px 导航 + 280px 会话列表 + 聊天区。 */
function fallbackRelationship(userName: string): RelationshipProfile {
  const now = Date.now();
  return {
    version: 1,
    type: "朋友",
    confidence: 0.3,
    userName,
    herNicknameForUser: "你",
    userFacts: [],
    notes: "默认关系；可在设置 → 关系与称呼中修改。",
    summary: "你们目前是「朋友」关系（默认值，可修改）。",
    updatedAt: now,
    source: { messages: 0, herMessages: 0, spanDays: 0 },
  };
}

export function ChatShell(): ReactElement {
  const db = useDatabase();
  const llm = useLlmConfig();
  const persona = usePersona();
  const emotion = useEmotion();
  const analytics = useAnalytics();
  const onboarding = useOnboarding();
  const pin = usePin();
  const { profile, storageError, setName, setAvatar, reset } = useProfile(db.ready);
  const { toast, show } = useToast();
  const conversations = useConversations(db.ready);
  const activeConversation = conversations.active;
  const herName = activeConversation?.herName ?? displayName(profile.her, "ta");
  const herAvatar = activeConversation?.herAvatar ?? profile.her.avatar;
  const meName = displayName(profile.me, "我");
  const her = useMemo<PersonProfile>(() => ({ name: herName, avatar: herAvatar }), [herAvatar, herName]);
  const relationship = useRelationship(herName, meName, db.ready);
  const styleFeedback = useStyleFeedback();
  const { messages, typing, unread, sendText, sendImage, appendImported, appendProactive, resetToGreeting, recallLastMessage, deleteMessage, clear, markRead } = useChat({
    persona: persona.profile,
    llm: llm.config,
    herName,
    meName,
    emotion: emotion.effective,
    onEmotion: emotion.update,
    dbReady: db.ready && conversations.ready,
    conversationId: activeConversation?.id,
    relationship: relationship.profile,
    styleCalibration: styleFeedback.calibration,
    moodNote: emotion.moodNote,
    onNotice: show,
  });

  const [railTab, setRailTab] = useState<RailTab>("chat");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmTest, setLlmTest] = useState<{ ok: boolean; text: string; error: string } | null>(null);
  const [lastUserAt, setLastUserAt] = useState(0);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: ChatMsg; x: number; y: number } | null>(null);
  const [reminder, setReminder] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [personaStartOpen, setPersonaStartOpen] = useState(false);
  const [styleReview, setStyleReview] = useState<{ id: string; text: string } | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [insertDraft, setInsertDraft] = useState<{ id: number; text: string } | null>(null);
  const night = new Date().getHours() >= 23 || new Date().getHours() < 7;
  const suppressConversationSync = useRef(false);
  const defaultConversationChecked = useRef(false);
  const loadedConversationRef = useRef<string | null>(null);
  const [convMenu, setConvMenu] = useState<{ record: ConversationRecord; x: number; y: number } | null>(null);
  const [searchResults, setSearchResults] = useState<ConversationSearchResults>({ conversations: [], messages: [] });

  useEffect(() => {
    if (onboarding.ready && onboarding.done && db.ready && persona.ready && !persona.profile) {
      setPersonaStartOpen(true);
    }
  }, [db.ready, onboarding.done, onboarding.ready, persona.profile, persona.ready]);

  const createConversation = useCallback(
    async (
      profile: PersonaProfile,
      relation: RelationshipProfile,
      title: string,
      greeting: string,
    ): Promise<void> => {
      const now = Date.now();
      const id = `conv-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const record: ConversationRecord = {
        id,
        title,
        herName: "ta",
        herAvatar: null,
        persona: profile,
        relationship: relation,
        greeting,
        lastPreview: greeting,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
      conversations.upsert(record);
      const message = { id: `greet-${id}`, from: "her" as const, kind: "text" as const, text: greeting, ts: now };
      await api.chatAppend(message.id, message.ts, JSON.stringify({ ...message, convId: id })).catch(() => undefined);
      conversations.setActive(id);
      persona.replace(profile);
      relationship.replace(relation);
      await onboarding.complete();
      setPersonaStartOpen(false);
      setRailTab("chat");
      show(`已创建「${title}」，可以开始聊天了`);
    },
    [conversations, onboarding, persona, relationship, show],
  );

  const handleCreatePreset = useCallback(
    async (preset: PersonaPreset): Promise<void> => {
      const profile = buildPresetPersona(preset, Date.now());
      const relation = buildPresetRelationship(preset, meName);
      await createConversation(profile, relation, preset.label, preset.greeting);
    },
    [createConversation, meName],
  );

  const handleCreateCustom = useCallback(
    async (form: CustomPersonaForm): Promise<void> => {
      const profile = buildCustomPersona(form, Date.now());
      const relation = buildCustomRelationship(form, meName);
      await createConversation(profile, relation, "自定义人格", "在的，今天想聊点什么？");
    },
    [createConversation, meName],
  );

  // 旧数据：只有 persona/chat_message，没有会话记录时，创建默认会话
  useEffect(() => {
    if (!db.ready || !conversations.ready || !persona.ready) return;
    if (conversations.items.length === 0) {
      if (!persona.profile) return;
      const now = Date.now();
      const record: ConversationRecord = {
        id: "default",
        title: displayName(profile.her, "ta"),
        herName: displayName(profile.her, "ta"),
        herAvatar: profile.her.avatar,
        persona: persona.profile,
        relationship: relationship.profile ?? fallbackRelationship(meName),
        greeting: "",
        createdAt: now,
        updatedAt: now,
      };
      conversations.upsert(record);
      conversations.setActive("default");
      return;
    }
    if (!conversations.activeId) conversations.setActive(conversations.items[0]!.id);
  }, [
    conversations,
    db.ready,
    meName,
    persona.profile,
    persona.ready,
    profile.her,
    relationship.profile,
  ]);

  // 当前会话的人格/关系变化同步到会话记录
  useEffect(() => {
    if (!activeConversation || !persona.profile) return;
    conversations.update(activeConversation.id, {
      persona: persona.profile,
      relationship: relationship.profile ?? activeConversation.relationship,
    });
  }, [activeConversation?.id, conversations.update, persona.profile, relationship.profile]);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setSearchResults({ conversations: [], messages: [] });
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const matchedConversations = conversations.items.filter(
          (item) => item.title.includes(term) || item.herName.includes(term),
        );
        const matchedMessages: ConversationSearchResults["messages"] = [];
        try {
          const rows = await api.chatLoad(2000);
          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.payload) as ChatMsg & { convId?: string };
              if (parsed.kind !== "text" || !parsed.text?.includes(term)) continue;
              const conversation = conversations.items.find((item) => item.id === (parsed.convId ?? "default"));
              matchedMessages.push({
                convId: parsed.convId ?? "default",
                title: conversation?.title ?? "未命名聊天",
                text: parsed.text,
                ts: parsed.ts,
                sender: parsed.from,
              });
            } catch {
              /* 跳过损坏消息 */
            }
          }
        } catch {
          /* 搜索失败时至少保留聊天名结果 */
        }
        if (!alive) return;
        setSearchResults({
          conversations: matchedConversations,
          messages: matchedMessages.sort((a, b) => b.ts - a.ts).slice(0, 30),
        });
      })();
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [conversations.items, search]);

  const deleteConversationMessages = useCallback(async (id: string): Promise<void> => {
    const rows = await api.chatLoad(2000).catch(() => []);
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload) as ChatMsg & { convId?: string };
        if ((parsed.convId ?? "default") === id) await api.chatDelete(row.id);
      } catch {
        /* 跳过损坏消息 */
      }
    }
  }, []);

  const handleClearConversation = useCallback(
    async (record: ConversationRecord): Promise<void> => {
      if (!window.confirm(`清空「${record.title}」的聊天记录？消息会从本机删除，但保留这个聊天和人格。`)) return;
      await deleteConversationMessages(record.id);
      conversations.update(record.id, { lastPreview: "还没有开始", lastMessageAt: 0 });
      if (record.id === activeConversation?.id) clear();
      show("聊天记录已清空");
    },
    [activeConversation?.id, clear, conversations, deleteConversationMessages, show],
  );

  const handleDeleteConversation = useCallback(
    async (record: ConversationRecord): Promise<void> => {
      if (!window.confirm(`删除「${record.title}」？这个聊天和人格会从列表移除。`)) return;
      if (!window.confirm("删除后聊天记录不可恢复，再次确认永久删除？")) return;
      await deleteConversationMessages(record.id);
      const remaining = conversations.items.filter((item) => item.id !== record.id);
      conversations.remove(record.id);
      if (record.id === activeConversation?.id) {
        clear();
        const next = remaining[0];
        if (next) {
          persona.replace(next.persona);
          relationship.replace(next.relationship);
          conversations.setActive(next.id);
        } else {
          conversations.setActive(null);
        }
      }
      show("聊天已删除");
    },
    [activeConversation?.id, clear, conversations, deleteConversationMessages, persona, relationship, show],
  );

  const importer = useImport(async (result) => {
    await db.refresh();
    await persona.buildFromImport(result.messages);
    const importedProfile = (await api.personaLoad()) as PersonaProfile | null;
    if (importedProfile) {
      const now = Date.now();
      const relation = relationship.profile ?? fallbackRelationship(meName);
      const record: ConversationRecord = {
        id: `conv-${now.toString(36)}`,
        title: displayName(profile.her, "ta"),
        herName: displayName(profile.her, "ta"),
        herAvatar: profile.her.avatar,
        persona: importedProfile,
        relationship: relation,
        greeting: "",
        lastPreview: "还没有开始",
        createdAt: now,
        updatedAt: now,
      };
      conversations.upsert(record);
      conversations.setActive(record.id);
      relationship.replace(relation);
      setPersonaStartOpen(false);
      await onboarding.complete();
    }
    if (!relationship.profile) void relationship.rebuild();
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

  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - start >= 90 * 60_000) setReminder(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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

  const handleTestLlm = useCallback(
    async (config: { provider: string; baseUrl: string; model: string; fastModel: string; apiKey: string; temperature: number }) => {
      setLlmTesting(true);
      setLlmTest(null);
      try {
        await llm.save(config);
        const result = await api.llmTest();
        setLlmTest(result);
      } catch (error) {
        setLlmTest({ ok: false, text: "", error: error instanceof Error ? error.message : String(error) });
      } finally {
        setLlmTesting(false);
      }
    },
    [llm],
  );

  const handleBackup = useCallback(async (passphrase: string) => {
    setSafetyBusy(true);
    setSafetyMessage(null);
    try {
      const result = await api.backupExport(passphrase);
      setSafetyMessage(result.ok ? `备份已保存：${result.path}` : result.message);
    } catch (error) {
      setSafetyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSafetyBusy(false);
    }
  }, []);

  const handleRestore = useCallback(async (passphrase: string) => {
    setSafetyBusy(true);
    setSafetyMessage(null);
    try {
      const result = await api.backupRestore(passphrase);
      setSafetyMessage(result.message);
    } catch (error) {
      setSafetyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSafetyBusy(false);
    }
  }, []);

  const handleDestroy = useCallback(
    async (confirm: string) => {
      setSafetyBusy(true);
      setSafetyMessage(null);
      try {
        const result = await api.dataDestroy(confirm);
        setSafetyMessage(result.message);
        clear();
      } catch (error) {
        setSafetyMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setSafetyBusy(false);
      }
    },
    [clear],
  );

  const handleImported = useCallback(
    (files: ImportedMediaFile[]) => {
      appendImported(files);
      setRailTab("chat");
    },
    [appendImported],
  );
  const media = useMediaImport(handleImported);

  const me = useMemo<PersonProfile>(
    () => ({ name: displayName(profile.me, "我"), avatar: profile.me.avatar }),
    [profile.me],
  );

  const last = lastMessageOf(messages);
  const previewText = typing ? "对方正在输入…" : messagePreview(last);
  const lastTs = last?.ts ?? Date.now();

  const settingsProfile = useMemo(
    () =>
      activeConversation
        ? {
            ...profile,
            her: { ...profile.her, name: activeConversation.herName, avatar: activeConversation.herAvatar },
          }
        : profile,
    [activeConversation, profile],
  );

  const handleNameChange = useCallback(
    (who: "her" | "me", name: string) => {
      setName(who, name);
      if (who === "her" && activeConversation) {
        conversations.update(activeConversation.id, {
          herName: name,
          title:
            activeConversation.title === activeConversation.herName ? name : activeConversation.title,
        });
      }
    },
    [activeConversation, conversations, setName],
  );

  const handleAvatarChange = useCallback(
    (who: "her" | "me", avatar: string | null) => {
      setAvatar(who, avatar);
      if (who === "her" && activeConversation) {
        conversations.update(activeConversation.id, { herAvatar: avatar });
      }
    },
    [activeConversation, conversations, setAvatar],
  );

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const handleSelectConversation = useCallback(
    (id?: string) => {
      setRailTab("chat");
      if (!id) {
        setSearch("");
        return;
      }
      if (id === activeConversation?.id) {
        setSearch("");
        markRead();
        return;
      }
      if (activeConversation && persona.profile) {
        conversations.update(activeConversation.id, {
          persona: persona.profile,
          relationship: relationship.profile ?? activeConversation.relationship,
        });
      }
      const target = conversations.items.find((item) => item.id === id);
      if (!target) return;
      conversations.setActive(id);
      persona.replace(target.persona);
      relationship.replace(target.relationship);
      setSearch("");
      setRailTab("chat");
    },
    [activeConversation, conversations, markRead, persona, relationship],
  );

  const handleRailSelect = useCallback((tab: RailTab) => {
    setRailTab(tab);
    if (tab !== "chat") setSearch("");
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      setLastUserAt(Date.now());
      analytics.log("message_me");
      if (!loggedFirst.current) {
        loggedFirst.current = true;
        analytics.log("first_message");
      }
      sendText(text);
    },
    [analytics, sendText],
  );

  const proactive = useProactive({
    persona: persona.profile,
    llm: llm.config,
    herName,
    meName,
    relationship: relationship.profile,
    styleCalibration: styleFeedback.calibration,
    moodNote: emotion.moodNote,
    recentMessages: messages
      .filter((message) => message.kind === "text" && message.from !== "system")
      .slice(-8)
      .map((message) => ({
        from: message.from === "her" ? ("her" as const) : ("me" as const),
        text: message.kind === "text" ? message.text : "",
      })),
    lastUserAt,
    onMessage: (text) => {
      appendProactive(text);
      analytics.log("proactive_sent");
      setRailTab("chat");
    },
    onNotice: show,
  });

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
    <div className={`chat-shell${night ? " night" : ""}`}>
      <NavRail me={me} active={railTab} onSelect={handleRailSelect} onOpenSettings={() => setSettingsOpen(true)} />

      {railTab === "chat" ? (
        <ConversationList
          items={conversations.items}
          activeId={conversations.activeId}
          search={search}
          searchResults={searchResults}
          onSearch={setSearch}
          onSelect={handleSelectConversation}
          onAdd={() => setPersonaStartOpen(true)}
          onContextMenu={(record, event) => {
            event.preventDefault();
            setConvMenu({ record, x: event.clientX, y: event.clientY });
          }}
        />
      ) : (
        <SidePanel tab={railTab} her={her} onOpenChat={handleSelectConversation} />
      )}

      <main className="chat-main">
        <ChatHeader
          her={her}
          typing={typing}
          onOpenSettings={() => setSettingsOpen(true)}
          onRecall={recallLastMessage}
          onMemory={() => setMemoryOpen(true)}
          onMood={() => setMoodOpen(true)}
        />
        {reminder && (
          <div className="safety-banner">
            已经聊了一段时间了。要不要起身喝口水、看看窗外？现实里的你也重要。
            <button type="button" className="link-btn" onClick={() => setReminder(false)}>
              知道了
            </button>
          </div>
        )}
        {messages.length === 0 && persona.profile !== null && (
          <div className="chat-ready-hint">已生成 ta 的人格卡，发一句试试。</div>
        )}
        <MessageList
          messages={messages}
          her={her}
          me={me}
          typing={typing}
          onPreview={setPreview}
          onMessageMenu={(message, event) => setMessageMenu({ message, x: event.clientX, y: event.clientY })}
        />
        <Composer
          onSend={handleSend}
          onPickImage={handlePickImage}
          onUnavailable={handleUnavailable}
          insert={insertDraft}
        />
      </main>

      {settingsOpen && (
        <SettingsDrawer
          onClose={closeSettings}
          profile={settingsProfile}
          storageError={storageError}
          onNameChange={handleNameChange}
          onAvatarChange={handleAvatarChange}
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
          llmTesting={llmTesting}
          llmTest={llmTest}
          onSaveLlm={(config) => {
            void llm.save(config);
          }}
          onTestLlm={() => {
            void handleTestLlm(llm.config);
          }}
          persona={persona.profile}
          personaBusy={persona.busy}
          personaMessage={persona.message}
          onRebuildPersona={() => {
            void persona.rebuildFromDb();
          }}
          emotion={emotion.effective}
          relationship={relationship.profile}
          relationshipBusy={relationship.busy}
          relationshipMessage={relationship.message}
          onSaveRelationship={(next) => {
            void relationship.save(next);
          }}
          onRebuildRelationship={() => {
            void relationship.rebuild();
          }}
          styleReviewEnabled={styleFeedback.enabled}
          styleFeedbackCount={styleFeedback.feedback.length}
          onToggleStyleReview={styleFeedback.setEnabled}
          onClearStyleFeedback={styleFeedback.clear}
          onOpenMood={() => setMoodOpen(true)}
          onOpenPersonaStart={() => setPersonaStartOpen(true)}
          analyticsCounts={analytics.counts}
          analyticsTotal={analytics.total}
          onClearAnalytics={analytics.clear}
          proactiveState={proactive.state}
          proactiveBusy={proactive.busy}
          proactiveReason={proactive.planReason}
          onToggleProactive={proactive.setEnabled}
          onSetProactiveDesire={proactive.setDesire}
          onUpdateProactive={proactive.updateSettings}
          onPauseProactive={proactive.setPaused}
          onTestProactive={() => {
            void proactive.test();
          }}
          safetyBusy={safetyBusy}
          safetyMessage={safetyMessage}
          onBackup={(passphrase) => {
            void handleBackup(passphrase);
          }}
          onRestore={(passphrase) => {
            void handleRestore(passphrase);
          }}
          onDestroy={(confirm) => {
            void handleDestroy(confirm);
          }}
          pinEnabled={pin.enabled}
          pinError={pin.error}
          onSetPin={(value) => {
            void pin.setPin(value);
          }}
          onDisablePin={(value) => {
            void pin.disable(value);
          }}
          personaHistoryCount={persona.historyCount}
          onUpdateFacts={(facts) => {
            void persona.updateFacts(facts);
          }}
          onUpdatePersona={(patch) => {
            void persona.updateProfile(patch);
          }}
          onRollbackPersona={() => {
            void persona.rollback();
          }}
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

      <LockScreen
        open={pin.locked}
        error={pin.error}
        onUnlock={pin.unlock}
        onForgot={() => {
          if (window.confirm("忘记 PIN 只能删除本机数据。确认删除？")) {
            void api.dataDestroy("删除").then(() => window.location.reload());
          }
        }}
      />

      <Onboarding
        open={onboarding.ready && !onboarding.done && db.ready}
        dbStats={db.stats}
        importState={importer.state}
        persona={persona.profile}
        llmConfig={llm.config}
        onOpenImport={openImport}
        onSaveLlm={(config) => {
          void llm.save(config);
        }}
        onFinish={onboarding.complete}
        onSkip={onboarding.complete}
        onSkipToPreset={() => {
          void onboarding.complete();
          setPersonaStartOpen(true);
        }}
      />

      <PersonaStart
        open={personaStartOpen}
        busy={persona.busy}
        onImport={() => {
          setPersonaStartOpen(false);
          openImport();
        }}
        onCreatePreset={handleCreatePreset}
        onCreateCustom={handleCreateCustom}
        onSkip={() => setPersonaStartOpen(false)}
      />

      {messageMenu !== null && (
        <div className="message-menu-backdrop" onClick={() => setMessageMenu(null)}>
          <div
            className="message-menu"
            style={{ left: messageMenu.x, top: messageMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {messageMenu.message.kind === "text" && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(messageMenu.message.kind === "text" ? messageMenu.message.text : "");
                  setMessageMenu(null);
                }}
              >
                复制
              </button>
            )}
            {messageMenu.message.kind === "text" && (
              <button
                type="button"
                onClick={() => {
                  setInsertDraft({
                    id: Date.now(),
                    text: `「${messageMenu.message.kind === "text" ? messageMenu.message.text : ""}」\
`,
                  });
                  setMessageMenu(null);
                }}
              >
                引用
              </button>
            )}
            {messageMenu.message.from === "me" && messageMenu.message.kind === "text" && (
              <button
                type="button"
                onClick={() => {
                  deleteMessage(messageMenu.message.id);
                  setInsertDraft({ id: Date.now(), text: messageMenu.message.kind === "text" ? messageMenu.message.text : "" });
                  setMessageMenu(null);
                }}
              >
                重新编辑
              </button>
            )}
            {messageMenu.message.from === "her" && (
              <button
                type="button"
                onClick={() => {
                  recallLastMessage();
                  setMessageMenu(null);
                }}
              >
                撤回
              </button>
            )}
            {messageMenu.message.from === "her" && messageMenu.message.kind === "text" && (
              <button
                type="button"
                onClick={() => {
                  setStyleReview({
                    id: messageMenu.message.id,
                    text: messageMenu.message.kind === "text" ? messageMenu.message.text : "",
                  });
                  setMessageMenu(null);
                }}
              >
                风格校准
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                deleteMessage(messageMenu.message.id);
                setMessageMenu(null);
              }}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {convMenu !== null && (
        <div className="message-menu-backdrop" onClick={() => setConvMenu(null)}>
          <div
            className="message-menu"
            style={{ left: convMenu.x, top: convMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const record = convMenu.record;
                setConvMenu(null);
                void handleClearConversation(record);
              }}
            >
              清空聊天记录
            </button>
            <button
              type="button"
              onClick={() => {
                const record = convMenu.record;
                setConvMenu(null);
                void handleDeleteConversation(record);
              }}
            >
              删除聊天（不可恢复）
            </button>
          </div>
        </div>
      )}

      <MemoryModal
        open={memoryOpen}
        samples={persona.profile?.samples ?? []}
        onClose={() => setMemoryOpen(false)}
      />

      <MoodPanel
        open={moodOpen}
        current={emotion.effective}
        note={emotion.moodNote}
        onSave={(state, note, until) => emotion.setOverride(state, note, until)}
        onClear={emotion.clearOverride}
        onClose={() => setMoodOpen(false)}
      />

      {styleReview && (
        <StyleReviewModal
          text={styleReview.text}
          onSave={(rating, tags, corrected) => {
            styleFeedback.add({ messageId: styleReview.id, text: styleReview.text, rating, tags, correctedText: corrected });
            show("已记录，下一轮会参考");
          }}
          onClose={() => setStyleReview(null)}
        />
      )}

      <ImageLightbox image={preview} onClose={() => setPreview(null)} />
      <Toast text={toast?.text ?? null} />
    </div>
  );
}
