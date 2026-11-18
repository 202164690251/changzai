import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";
import { buildRecordedVoice, type RecordedVoice } from "../lib/voiceRecorder.ts";
import { Icon } from "./Icons.tsx";

const EMOJIS = [
  "🙂",
  "😊",
  "😅",
  "😴",
  "🥺",
  "😭",
  "😡",
  "🤔",
  "👀",
  "🙈",
  "🌙",
  "🌸",
  "☕",
  "🍜",
  "🎧",
  "📷",
  "✨",
  "❤️",
  "👍",
  "🤝",
  "🥱",
  "🌧️",
  "🎂",
  "🐱",
];

export type ComposerAction = "file" | "screenshot" | "voice";

export interface ComposerProps {
  onSend: (text: string) => void;
  onPickImage: (file: File) => void;
  onUnavailable: (action: ComposerAction) => void;
  onVoice: (voice: RecordedVoice) => void;
  voiceBusy?: boolean;
  onNotice?: (message: string) => void;
  insert?: { id: number; text: string } | null;
}

/** 底部输入区：表情 / 图片 / 文件 / 截图 / 语音 + 多行输入 + 绿色发送。 */
export function Composer({ onSend, onPickImage, onUnavailable, onVoice, voiceBusy = false, onNotice, insert }: ComposerProps): ReactElement {
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const canSend = draft.trim().length > 0;

  useEffect(() => {
    if (!insert) return;
    setDraft(insert.text);
    inputRef.current?.focus();
  }, [insert?.id]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [draft]);

  useEffect(() => {
    if (!emojiOpen) return;
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".emoji-panel") || target.closest(".emoji-toggle")) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [emojiOpen]);

  const stopRecording = (): void => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    setRecording(false);
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async (): Promise<void> => {
    if (recording || voiceBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNotice?.("这台电脑的 WebView 不支持录音");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        chunksRef.current = [];
        if (blob.size < 200) {
          onNotice?.("录音太短了，再说一句试试");
          return;
        }
        void buildRecordedVoice(blob, duration)
          .then((voice) => onVoice(voice))
          .catch((error: unknown) =>
            onNotice?.(error instanceof Error ? error.message : "录音处理失败"),
          );
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setElapsed(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(seconds);
        if (seconds >= 60) stopRecording();
      }, 250);
    } catch (error) {
      onNotice?.(error instanceof Error ? `麦克风没有打开：${error.message}` : "麦克风没有打开");
    }
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const submit = (): void => {
    if (!canSend) return;
    onSend(draft);
    setDraft("");
    setEmojiOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const appendEmoji = (emoji: string): void => {
    setDraft((previous) => previous + emoji);
    inputRef.current?.focus();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onPickImage(file);
  };

  return (
    <footer className="composer">
      <div className="composer-panel">
        <textarea
          ref={inputRef}
          className="composer-input"
          value={draft}
          rows={1}
          placeholder={recording ? "录音中…再点一下麦克风发送" : "说点什么…"}
          aria-label="输入消息"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
        />

        {recording && (
          <div className="recording-bar" role="status">
            <span className="recording-dot" />
            <span>录音中 {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>
            <span className="recording-hint">说完再点一下麦克风发送</span>
          </div>
        )}
        <div className="composer-bar">
          <div className="composer-tools">
            <button
              type="button"
              className="tool-btn emoji-toggle"
              title="表情"
              aria-label="表情"
              aria-pressed={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
            >
              <Icon name="emoji" size={21} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="图片"
              aria-label="发送图片"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="image" size={21} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="文件"
              aria-label="发送文件"
              onClick={() => onUnavailable("file")}
            >
              <Icon name="file" size={21} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="截图"
              aria-label="截图"
              onClick={() => onUnavailable("screenshot")}
            >
              <Icon name="screenshot" size={20} />
            </button>

          </div>

          <div className="composer-send-group">
            <button
              type="button"
              className={`tool-btn mic-btn${recording ? " is-recording" : ""}`}
              title={recording ? "结束录音并发送" : "录制语音"}
              aria-label={recording ? "结束录音并发送" : "录制语音"}
              aria-pressed={recording}
              disabled={voiceBusy}
              onClick={() => {
                if (recording) stopRecording();
                else void startRecording();
              }}
            >
              <Icon name={recording ? "pause" : "mic"} size={21} />
            </button>
            <button type="button" className="send-btn" disabled={!canSend} onClick={submit}>
              发送
            </button>
          </div>
        </div>

        {emojiOpen && (
          <div className="emoji-panel" role="dialog" aria-label="表情">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-item"
                aria-label={emoji}
                onClick={() => appendEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </footer>
  );
}
