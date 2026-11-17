import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
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
import { Onboarding } from "./Onboarding.tsx";
import { MemoryModal } from "./MemoryModal.tsx";
import { MoodPanel } from "./MoodPanel.tsx";
import { StyleReviewModal } from "./StyleReviewModal.tsx";
import { LockScreen } from "./LockScreen.tsx";
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
  const onboarding = useOnboarding();
  const pin = usePin();
  const { profile, storageError, setName, setAvatar, reset } = useProfile(db.ready);
  const { toast, show } = useToast();
  const herName = displayName(profile.her, "ta");
  const meName = displayName(profile.me, "我");
  const relationship = useRelationship(herName, meName, db.ready);
  const styleFeedback = useStyleFeedback();
  const { messages, typing, unread, sendText, sendImage, appendImported, appendProactive, recallLastMessage, deleteMessage, clear, markRead } = useChat({
    persona: persona.profile,
    llm: llm.config,
    herName,
    meName,
    emotion: emotion.effective,
    onEmotion: emotion.update,
    dbReady: db.ready,
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
  const [styleReview, setStyleReview] = useState<{ id: string; text: string } | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [insertDraft, setInsertDraft] = useState<{ id: number; text: string } | null>(null);
  const night = new Date().getHours() >= 23 || new Date().getHours() < 7;
  const importer = useImport(async (result) => {
    await db.refresh();
    await persona.buildFromImport(result.messages);
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
