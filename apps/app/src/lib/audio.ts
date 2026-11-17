// 语音消息同一时间只允许一条在播：新的开始播放时，旧的先暂停。

let activeAudio: HTMLAudioElement | null = null;

export function claimVoicePlayback(audio: HTMLAudioElement): void {
  if (activeAudio !== null && activeAudio !== audio) activeAudio.pause();
  activeAudio = audio;
}

export function releaseVoicePlayback(audio: HTMLAudioElement): void {
  if (activeAudio === audio) activeAudio = null;
}
