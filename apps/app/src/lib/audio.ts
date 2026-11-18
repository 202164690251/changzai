// 语音消息同一时间只允许一条在播：新的开始播放时，旧的先暂停。

let activeAudio: HTMLAudioElement | null = null;

export function claimVoicePlayback(audio: HTMLAudioElement): void {
  if (activeAudio !== null && activeAudio !== audio) activeAudio.pause();
  activeAudio = audio;
}

export function releaseVoicePlayback(audio: HTMLAudioElement): void {
  if (activeAudio === audio) activeAudio = null;
}


/** 开始录音前停掉正在播放的语音/TTS，避免麦克风把扬声器声音录进去。 */
export function stopVoicePlayback(): void {
  if (activeAudio !== null) {
    activeAudio.pause();
    activeAudio = null;
  }
}
