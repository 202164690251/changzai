// V2.1 TTS：默认 Windows 本机语音（无需 Key）；可选 OpenAI 兼容 /audio/speech 云语音。
use base64::Engine as _;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub rate: i32,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsResult {
    pub audio_base64: String,
    pub mime: String,
    pub provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    pub name: String,
    pub culture: String,
}

fn clean_text(text: &str) -> Result<String, String> {
    let value = text.trim();
    if value.is_empty() {
        return Err("没有可朗读的文字".into());
    }
    if value.chars().count() > 1500 {
        return Err("这段文字太长，先分成短句再朗读".into());
    }
    Ok(value.to_string())
}

#[tauri::command]
pub async fn tts_speak(request: TtsRequest) -> Result<TtsResult, String> {
    let text = clean_text(&request.text)?;
    if request.provider == "openai" {
        return openai_speak(&request, &text).await;
    }
    let mut req = request;
    req.text = text;
    tauri::async_runtime::spawn_blocking(move || windows_speak(&req))
        .await
        .map_err(|error| format!("朗读任务没有完成: {error}"))?
}

async fn openai_speak(request: &TtsRequest, text: &str) -> Result<TtsResult, String> {
    if request.api_key.trim().is_empty() {
        return Err("云 TTS 需要先在设置里填写 API Key；也可以切回 Windows 本机语音".into());
    }
    let base = if request.base_url.trim().is_empty() {
        "https://api.openai.com/v1"
    } else {
        request.base_url.trim().trim_end_matches('/')
    };
    let url = if base.ends_with("/audio/speech") {
        base.to_string()
    } else {
        format!("{base}/audio/speech")
    };
    let model = if request.model.trim().is_empty() {
        "tts-1"
    } else {
        request.model.trim()
    };
    let voice = if request.voice.trim().is_empty() {
        "alloy"
    } else {
        request.voice.trim()
    };
    let payload = serde_json::json!({
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": "mp3"
    });
    let response = reqwest::Client::new()
        .post(&url)
        .bearer_auth(request.api_key.trim())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|error| format!("云 TTS 请求失败: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let snippet = body.chars().take(300).collect::<String>();
        return Err(format!("云 TTS 返回 {status}: {snippet}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("云 TTS 读取音频失败: {error}"))?;
    if bytes.is_empty() {
        return Err("云 TTS 返回了空音频".into());
    }
    Ok(TtsResult {
        audio_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        mime: "audio/mpeg".into(),
        provider: "openai".into(),
    })
}

#[cfg(windows)]
fn windows_speak(request: &TtsRequest) -> Result<TtsResult, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let id = format!("{}-{}", std::process::id(), rand::random::<u64>());
    let dir = std::env::temp_dir();
    let text_path = dir.join(format!("changzai-tts-{id}.txt"));
    let out_path = dir.join(format!("changzai-tts-{id}.wav"));
    std::fs::write(&text_path, request.text.as_bytes())
        .map_err(|error| format!("写入朗读文本失败: {error}"))?;

    let script = r#"Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($env:CZ_TTS_VOICE) { $s.SelectVoice($env:CZ_TTS_VOICE) }
  $s.Rate = [int]$env:CZ_TTS_RATE
  $s.SetOutputToWaveFile($env:CZ_TTS_OUT)
  $s.Speak([IO.File]::ReadAllText($env:CZ_TTS_TEXT))
} finally {
  $s.Dispose()
}"#;

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("CZ_TTS_TEXT", &text_path)
        .env("CZ_TTS_OUT", &out_path)
        .env("CZ_TTS_VOICE", request.voice.trim())
        .env("CZ_TTS_RATE", request.rate.clamp(-10, 10).to_string());
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let output = command
        .output()
        .map_err(|error| format!("启动 Windows 语音失败: {error}"));
    let result = match output {
        Ok(output) => {
            if output.status.success() {
                std::fs::read(&out_path)
                    .map_err(|error| format!("读取语音文件失败: {error}"))
                    .and_then(|bytes| {
                        if bytes.len() <= 44 {
                            Err("Windows 语音没有生成有效音频".to_string())
                        } else {
                            Ok(TtsResult {
                                audio_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                                mime: "audio/wav".into(),
                                provider: "windows".into(),
                            })
                        }
                    })
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!(
                    "Windows 语音失败：{}",
                    stderr.chars().take(300).collect::<String>()
                ))
            }
        }
        Err(error) => Err(error),
    };
    let _ = std::fs::remove_file(&text_path);
    let _ = std::fs::remove_file(&out_path);
    result
}

#[cfg(not(windows))]
fn windows_speak(_request: &TtsRequest) -> Result<TtsResult, String> {
    Err("Windows 本机语音只在 Windows 上可用".into())
}

#[tauri::command]
pub async fn tts_voices() -> Result<Vec<TtsVoice>, String> {
    tauri::async_runtime::spawn_blocking(windows_voices)
        .await
        .map_err(|error| format!("读取系统语音失败: {error}"))?
}

#[cfg(windows)]
fn windows_voices() -> Result<Vec<TtsVoice>, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let script = r#"Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  foreach ($v in $s.GetInstalledVoices()) {
    if ($v.Enabled) { "$($v.VoiceInfo.Name)`t$($v.VoiceInfo.Culture)" }
  }
} finally {
  $s.Dispose()
}"#;
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(0x0800_0000);
    let output = command
        .output()
        .map_err(|error| format!("启动 Windows 语音失败: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).chars().take(300).collect());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut voices = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (name, culture) = line.split_once('\t').unwrap_or((line, ""));
        if !name.is_empty() {
            voices.push(TtsVoice {
                name: name.to_string(),
                culture: culture.to_string(),
            });
        }
    }
    Ok(voices)
}

#[cfg(not(windows))]
fn windows_voices() -> Result<Vec<TtsVoice>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::clean_text;

    #[test]
    fn rejects_empty_or_too_long() {
        assert!(clean_text("   ").is_err());
        assert!(clean_text(&"a".repeat(1501)).is_err());
        assert_eq!(clean_text(" 你好 ").unwrap(), "你好");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Windows SAPI voices; run locally with --ignored"]
    fn windows_sapi_generates_wav() {
        let request = super::TtsRequest {
            text: "你好，我在。".into(),
            provider: "windows".into(),
            voice: String::new(),
            rate: 0,
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        let result = super::windows_speak(&request).expect("Windows SAPI 应生成音频");
        assert!(result.audio_base64.len() > 1000);
        assert_eq!(result.mime, "audio/wav");
    }
}
