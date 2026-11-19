// 如晤 · 演示素材（不依赖任何外部网络图片）
// 图片是一条内联 SVG；语音是一段在本地合成的短促气声 WAV，用来演示语音气泡，不需要联网。

const DEMO_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 480 360">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#1f2440"/>
<stop offset="0.55" stop-color="#4b4568"/>
<stop offset="1" stop-color="#c98f68"/>
</linearGradient>
<linearGradient id="lamp" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#f8dcae"/>
<stop offset="1" stop-color="#e9a86a"/>
</linearGradient>
</defs>
<rect width="480" height="360" fill="url(#sky)"/>
<circle cx="368" cy="82" r="30" fill="#f6e7c3"/>
<circle cx="368" cy="82" r="46" fill="#f6e7c3" opacity="0.14"/>
<g fill="#ffffff" opacity="0.75">
<circle cx="72" cy="56" r="1.6"/>
<circle cx="128" cy="96" r="1.2"/>
<circle cx="186" cy="42" r="1.4"/>
<circle cx="250" cy="88" r="1.2"/>
<circle cx="312" cy="38" r="1.5"/>
<circle cx="420" cy="132" r="1.3"/>
<circle cx="102" cy="140" r="1.1"/>
<circle cx="286" cy="140" r="1.3"/>
</g>
<path d="M0 286 L96 236 L182 280 L280 220 L372 272 L480 214 L480 360 L0 360 Z" fill="#15192b" opacity="0.9"/>
<path d="M0 314 L110 272 L210 316 L318 262 L420 308 L480 280 L480 360 L0 360 Z" fill="#0d101d" opacity="0.95"/>
<g>
<rect x="38" y="190" width="118" height="92" rx="4" fill="url(#lamp)"/>
<rect x="38" y="190" width="118" height="92" rx="4" fill="none" stroke="#0d101d" stroke-width="5" opacity="0.35"/>
<path d="M97 190v92M38 236h118" stroke="#0d101d" stroke-width="5" opacity="0.35"/>
</g>
<path d="M166 282c0-26 12-46 27-46s27 20 27 46" fill="#0d101d" opacity="0.35"/>
</svg>`;

const DEMO_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEMO_IMAGE_SVG)}`;

/** 她的演示照片（内联 SVG，长度固定、不会动网）。 */
export function demoImageDataUrl(): string {
  return DEMO_IMAGE;
}

export const DEMO_VOICE_SECONDS = 4;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function makeWavDataUrl(seconds: number): string {
  const sampleRate = 8000;
  const total = Math.floor(sampleRate * seconds);
  const dataSize = total * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < total; index += 1) {
    const time = index / sampleRate;
    const fadeIn = Math.min(1, time / 0.25);
    const fadeOut = Math.min(1, (seconds - time) / 0.45);
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    const voice =
      Math.sin(2 * Math.PI * 196 * time) * 0.24 +
      Math.sin(2 * Math.PI * 392 * time) * 0.09 +
      Math.sin(2 * Math.PI * 98 * time) * 0.05;
    const wobble = 1 + 0.18 * Math.sin(2 * Math.PI * 3.2 * time);
    const sample = Math.max(-1, Math.min(1, voice * wobble * envelope));
    view.setInt16(44 + index * 2, Math.round(sample * 0.32 * 32767), true);
  }

  return `data:audio/wav;base64,${bytesToBase64(bytes)}`;
}

let cachedVoice: string | null = null;

/** 她的演示语音（本地合成的 4 秒气声 WAV）。 */
export function demoVoiceDataUrl(): string {
  if (cachedVoice === null) cachedVoice = makeWavDataUrl(DEMO_VOICE_SECONDS);
  return cachedVoice;
}
