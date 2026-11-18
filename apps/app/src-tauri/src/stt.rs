// V2.1 STT：默认用 Windows 本机中文听写，音频不离开本机。
use base64::Engine as _;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttRequest {
    #[serde(default)]
    pub audio_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttResult {
    pub text: String,
    pub confidence: f32,
}

#[tauri::command]
pub async fn stt_transcribe(request: SttRequest) -> Result<SttResult, String> {
    let raw = request.audio_base64.trim();
    if raw.is_empty() {
        return Err("没有录到声音".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|_| "录音数据格式不正确".to_string())?;
    if bytes.len() < 128 {
        return Err("录音太短了，再说一句试试".into());
    }
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("录音太长了，先控制在 60 秒内".into());
    }
    tauri::async_runtime::spawn_blocking(move || windows_transcribe(&bytes))
        .await
        .map_err(|error| format!("识别任务没有完成: {error}"))?
}

#[cfg(windows)]
fn windows_transcribe(bytes: &[u8]) -> Result<SttResult, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let id = format!("{}-{}", std::process::id(), rand::random::<u64>());
    let path = std::env::temp_dir().join(format!("changzai-stt-{id}.wav"));
    std::fs::write(&path, bytes).map_err(|error| format!("写入录音失败: {error}"))?;

    let script = r#"Add-Type -AssemblyName System.Speech
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$rec = $null
try {
  try {
    $culture = [System.Globalization.CultureInfo]::GetCultureInfo('zh-CN')
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  } catch {
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  }
  $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $rec.SetInputToWaveFile($env:CZ_STT_WAV)
  $result = $rec.Recognize()
  if ($result) {
    "$($result.Text)`t$($result.Confidence)"
  }
} finally {
  if ($rec) { $rec.Dispose() }
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
        .env("CZ_STT_WAV", &path)
        .creation_flags(0x0800_0000);
    let output = command
        .output()
        .map_err(|error| format!("启动 Windows 语音识别失败: {error}"));
    let result = match output {
        Ok(output) => {
            if !output.status.success() {
                Err(format!(
                    "Windows 语音识别失败：{}",
                    String::from_utf8_lossy(&output.stderr)
                        .chars()
                        .take(300)
                        .collect::<String>()
                ))
            } else {
                let text = String::from_utf8_lossy(&output.stdout);
                let line = text.lines().map(str::trim).filter(|line| !line.is_empty()).last();
                let Some(line) = line else {
                    return Err("没听清，再说一句试试".into());
                };
                let (recognized, confidence) = line.split_once('\t').unwrap_or((line, "0"));
                let recognized = recognized.trim();
                if recognized.is_empty() {
                    Err("没听清，再说一句试试".into())
                } else {
                    Ok(SttResult {
                        text: recognized.to_string(),
                        confidence: confidence.trim().parse::<f32>().unwrap_or(0.0),
                    })
                }
            }
        }
        Err(error) => Err(error),
    };
    let _ = std::fs::remove_file(&path);
    result
}

#[cfg(not(windows))]
fn windows_transcribe(_bytes: &[u8]) -> Result<SttResult, String> {
    Err("Windows 本机语音识别只在 Windows 上可用".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Windows SAPI voices; run locally with --ignored"]
    fn chinese_roundtrip_is_utf8() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let wav = std::env::temp_dir().join(format!("changzai-stt-roundtrip-{}.wav", std::process::id()));
        let script = r#"Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $s.SelectVoice('Microsoft Huihui Desktop')
  $s.SetOutputToWaveFile($env:CZ_STT_OUT)
  $s.Speak('今天天气怎么样')
} finally { $s.Dispose() }"#;
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
            .env("CZ_STT_OUT", &wav)
            .creation_flags(0x0800_0000);
        let status = command.status().expect("generate wav");
        assert!(status.success());
        let bytes = std::fs::read(&wav).expect("read wav");
        let result = super::windows_transcribe(&bytes).expect("transcribe");
        let _ = std::fs::remove_file(&wav);
        assert!(!result.text.contains('锟'), "mojibake: {}", result.text);
        assert!(!result.text.contains('�'), "replacement char: {}", result.text);
        assert!(result.text.contains("天气") || result.text.contains("今天"), "text: {}", result.text);
    }

    #[test]
    fn rejects_empty_audio() {
        let result = tauri::async_runtime::block_on(stt_transcribe(SttRequest {
            audio_base64: " ".into(),
        }));
        assert!(result.is_err());
    }
}
