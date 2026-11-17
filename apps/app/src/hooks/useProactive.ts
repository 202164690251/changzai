// Step 5 · 主动消息（T38 v0）
// 前端定时器 + 通知；关窗到托盘后由进程内 WebView 继续跑（后台节流见文档）。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROACTIVE_STATE,
  applyProactivePreset,
  buildSystemPrompt,
  filterAiFlavor,
  planProactive,
  recordProactiveSent,
  type PersonaProfile,
  type ProactiveDesire,
  type ProactiveState,
} from "@changzai/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { api, isTauri, type LlmConfig } from "../lib/tauri.ts";

const SETTING_KEY = "proactive.state";


export interface ProactiveOptions {
  persona: PersonaProfile | null;
  llm: LlmConfig | null;
  herName: string;
  meName: string;
  lastUserAt: number;
  onMessage: (text: string) => void;
  onNotice: (text: string) => void;
}

export interface ProactiveApi {
  state: ProactiveState;
  busy: boolean;
  planReason: string;
  setEnabled: (enabled: boolean) => void;
  setDesire: (level: ProactiveDesire) => void;
  updateSettings: (patch: Partial<ProactiveState>) => void;
  test: () => Promise<void>;
}

function llmReady(llm: LlmConfig | null): boolean {
  if (!llm) return false;
  return llm.apiKey.trim().length > 0 || /localhost|127\.0\.0\.1/.test(llm.baseUrl);
}

async function notify(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* 通知失败不影响站内消息 */
  }
}

export function useProactive(options: ProactiveOptions): ProactiveApi {
  const [state, setState] = useState<ProactiveState>(DEFAULT_PROACTIVE_STATE);
  const [busy, setBusy] = useState(false);
  const [planReason, setPlanReason] = useState("");
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const optionsRef = useRef(options);
  stateRef.current = state;
  optionsRef.current = options;
  busyRef.current = busy;

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await api.settingGet(SETTING_KEY);
        if (!alive || raw === null) return;
        const parsed = JSON.parse(raw) as Partial<ProactiveState>;
        setState({ ...DEFAULT_PROACTIVE_STATE, ...parsed });
      } catch {
        /* 默认关闭 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: ProactiveState) => {
    setState(next);
    if (isTauri()) {
      void api.settingSet(SETTING_KEY, JSON.stringify(next)).catch(() => undefined);
    }
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      persist({ ...stateRef.current, enabled });
    },
    [persist],
  );

  const setDesire = useCallback(
    (level: ProactiveDesire) => {
      persist(applyProactivePreset(stateRef.current, level));
    },
    [persist],
  );

  const updateSettings = useCallback(
    (patch: Partial<ProactiveState>) => {
      persist({ ...stateRef.current, ...patch });
    },
    [persist],
  );

  useEffect(() => {
    if (options.lastUserAt <= 0) return;
    persist({
      ...stateRef.current,
      lastUserAt: options.lastUserAt,
      consecutiveNoReply: 0,
    });
  }, [options.lastUserAt, persist]);

  const generate = useCallback(async (): Promise<void> => {
    if (busyRef.current) return;
    const { persona, llm, herName, meName, onMessage, onNotice } = optionsRef.current;
    if (!persona || !llmReady(llm)) {
      onNotice("主动消息需要人格卡和模型配置");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const system = `${buildSystemPrompt(persona, { name: herName, selfName: meName })}

【主动消息】
现在没有新消息。请主动发一条很短的消息（1–2 句），像突然想起对方；不要解释为什么发，不要问“在吗”，不要重复上次的话。只输出消息本身。`;
      let full = "";
      let error = "";
      await api.llmChatStream(
        [
          { role: "system", content: system },
          { role: "user", content: "（安静，没有新消息）" },
        ],
        (event) => {
          if (event.kind === "delta") full += event.text;
          if (event.kind === "error") error = event.text;
        },
      );
      if (error || !full.trim()) {
        onNotice(error || "主动消息没有生成成功");
        return;
      }
      const text = filterAiFlavor(full).text;
      if (!text) return;
      onMessage(text);
      void notify(herName, text);
      const now = Date.now();
      persist({
        ...recordProactiveSent(stateRef.current, now),
        lastUserAt: now,
        consecutiveNoReply: stateRef.current.consecutiveNoReply + 1,
      });
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [persist]);

  const test = useCallback(async () => {
    await generate();
  }, [generate]);

  useEffect(() => {
    if (!isTauri() || !state.enabled) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      const lastUserAt = Math.max(current.lastUserAt, optionsRef.current.lastUserAt);
      const plan = planProactive({ ...current, lastUserAt }, Date.now());
      setPlanReason(plan.reason);
      if (plan.shouldSend) void generate();
    }, Math.max(1, state.checkIntervalMinutes) * 60_000);
    return () => window.clearInterval(timer);
  }, [generate, state.checkIntervalMinutes, state.enabled]);

  return { state, busy, planReason, setEnabled, setDesire, updateSettings, test };
}
