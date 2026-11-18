import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { claimVoicePlayback, releaseVoicePlayback } from "../../lib/audio.ts";
import { formatDuration } from "../../lib/time.ts";
import { Icon } from "../Icons.tsx";

export interface VoiceBubbleProps {
  dataUrl: string;
  durationSec: number;
  side: "her" | "me";
  text?: string;
}

/** 语音气泡：宽度随秒数 60–220px，点击播放/暂停，时长以音频元数据为准。 */
export function VoiceBubble({ dataUrl, durationSec, side, text }: VoiceBubbleProps): ReactElement {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(durationSec > 0 ? durationSec : 0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = new Audio(dataUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    const handleMetadata = (): void => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const handlePause = (): void => {
      setPlaying(false);
      releaseVoicePlayback(audio);
    };
    const handleEnded = (): void => {
      setPlaying(false);
      releaseVoicePlayback(audio);
    };
    const handleError = (): void => {
      setFailed(true);
      setPlaying(false);
    };

    audio.addEventListener("loadedmetadata", handleMetadata);
    audio.addEventListener("durationchange", handleMetadata);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleMetadata);
      audio.removeEventListener("durationchange", handleMetadata);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      releaseVoicePlayback(audio);
      audio.src = "";
      audioRef.current = null;
    };
  }, [dataUrl]);

  const togglePlayback = (): void => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (playing) {
      audio.pause();
      return;
    }
    claimVoicePlayback(audio);
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        releaseVoicePlayback(audio);
        setPlaying(false);
      });
  };

  const seconds = duration > 0 ? duration : Math.max(durationSec, 1);
  const width = Math.round(Math.min(220, Math.max(60, 60 + seconds * 7)));
  const label = failed ? "语音" : duration > 0 ? formatDuration(duration) : "…";

  return (
    <button
      type="button"
      className={`bubble-voice ${side}${playing ? " is-playing" : ""}`}
      style={{ width }}
      title={text ? `语音：${text}` : failed ? "语音加载失败" : playing ? "暂停" : "播放"}
      aria-label={text ? `语音消息 ${Math.round(seconds)} 秒：${text}` : failed ? "语音加载失败" : `语音消息 ${Math.round(seconds)} 秒，点击${playing ? "暂停" : "播放"}`}
      onClick={togglePlayback}
    >
      <span className="voice-icon" aria-hidden="true">
        <Icon name={playing ? "pause" : "play"} size={15} />
      </span>
      <span className="voice-duration">{label}</span>
    </button>
  );
}
