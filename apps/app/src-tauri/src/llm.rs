// Step 3 · OpenAI 兼容的流式对话（Rust 侧，API Key 不出渲染进程）
//
// - 配置存在 SQLCipher DB 的 setting 表（llm.config），整库加密；
// - 请求走 Rust reqwest，SSE 增量通过 Tauri Channel 推给前端；
// - 支持 DeepSeek / OpenAI / 任意 OpenAI-compatible 网关。

use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::store;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_base_url() -> String {
    "https://api.deepseek.com/v1".to_string()
}

fn default_model() -> String {
    "deepseek-chat".to_string()
}

fn default_temperature() -> f32 {
    0.85
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            model: default_model(),
            api_key: String::new(),
            temperature: default_temperature(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEvent {
    /// delta / done / error
    pub kind: String,
    pub text: String,
}

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    store::app_dir(app)
}

pub(crate) fn load_config(app: &tauri::AppHandle) -> Result<LlmConfig, String> {
    let dir = config_path(app)?;
    let Some(raw) = store::read_setting_at(&dir, "llm.config")? else {
        return Ok(LlmConfig::default());
    };
    serde_json::from_str(&raw).map_err(|e| format!("模型配置损坏：{e}"))
}

fn save_config(app: &tauri::AppHandle, config: &LlmConfig) -> Result<(), String> {
    let dir = config_path(app)?;
    let raw = serde_json::to_string(config).map_err(|e| e.to_string())?;
    store::write_setting_at(&dir, "llm.config", &raw)
}

#[tauri::command]
pub fn llm_config_load(app: tauri::AppHandle) -> Result<LlmConfig, String> {
    load_config(&app)
}

#[tauri::command]
pub fn llm_config_save(app: tauri::AppHandle, config: LlmConfig) -> Result<bool, String> {
    if config.base_url.trim().is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("模型名不能为空".to_string());
    }
    let temperature = config.temperature.clamp(0.0, 2.0);
    save_config(
        &app,
        &LlmConfig {
            temperature,
            ..config
        },
    )?;
    Ok(true)
}

fn endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

/// 解析一行 SSE；返回 delta 文本（非 data 行 / 无法解析时返回 None）
pub(crate) fn parse_sse_line(line: &str) -> Option<String> {
    let data = line.trim().strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return None;
    }
    let value: Value = serde_json::from_str(data).ok()?;
    value
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(|text| text.to_string())
}

async fn stream_chat<F: FnMut(ChatEvent)>(
    config: &LlmConfig,
    messages: Vec<ChatMessage>,
    mut on_event: F,
) -> Result<(), String> {
    if config.api_key.trim().is_empty() && !config.base_url.contains("localhost") && !config.base_url.contains("127.0.0.1") {
        let _ = on_event(ChatEvent {
            kind: "error".to_string(),
            text: "还没有填写 API Key，请先在「设置 → 模型」里配置。".to_string(),
        });
        return Ok(());
    }

    let body = json!({
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "stream": true,
        "max_tokens": 512
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client
        .post(endpoint(&config.base_url))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    if !config.api_key.trim().is_empty() {
        request = request.bearer_auth(config.api_key.trim());
    }

    let response = match request.body(body.to_string()).send().await {
        Ok(response) => response,
        Err(error) => {
            let _ = on_event(ChatEvent {
                kind: "error".to_string(),
                text: format!("连接模型失败：{error}"),
            });
            return Ok(());
        }
    };

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let detail = text.chars().take(300).collect::<String>();
        let _ = on_event(ChatEvent {
            kind: "error".to_string(),
            text: format!("模型返回 {status}：{detail}"),
        });
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full = String::new();
    'outer: while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = on_event(ChatEvent {
                    kind: "error".to_string(),
                    text: format!("读取流失败：{error}"),
                });
                return Ok(());
            }
        };
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(index) = buffer.find('\n') {
            let line: String = buffer[..index].trim_end_matches('\r').to_string();
            buffer = buffer[index + 1..].to_string();
            if line.trim() == "data: [DONE]" || line.trim() == "data:[DONE]" {
                break 'outer;
            }
            if let Some(delta) = parse_sse_line(&line) {
                if !delta.is_empty() {
                    full.push_str(&delta);
                    let _ = on_event(ChatEvent {
                        kind: "delta".to_string(),
                        text: delta,
                    });
                }
            }
        }
    }

    if full.trim().is_empty() {
        let _ = on_event(ChatEvent {
            kind: "error".to_string(),
            text: "模型没有返回内容，请检查模型名或额度。".to_string(),
        });
    } else {
        let _ = on_event(ChatEvent {
            kind: "done".to_string(),
            text: full,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn llm_chat_stream(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let config = load_config(&app)?;
    stream_chat(&config, messages, move |event| {
        let _ = on_event.send(event);
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_openai_compatible() {
        let config = LlmConfig::default();
        assert!(config.base_url.starts_with("https://"));
        assert!(!config.model.is_empty());
        assert_eq!(config.temperature, 0.85);
    }

    #[test]
    fn endpoint_appends_chat_completions_once() {
        assert_eq!(
            endpoint("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://proxy.example.com/v1/chat/completions"),
            "https://proxy.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn parse_sse_line_extracts_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"你"}}]}"#;
        assert_eq!(parse_sse_line(line).as_deref(), Some("你"));
        assert_eq!(parse_sse_line("data: [DONE]"), None);
        assert_eq!(parse_sse_line("event: ping"), None);
        assert_eq!(parse_sse_line("data: not-json"), None);
    }

    #[tokio::test]
    async fn stream_chat_parses_sse_end_to_end() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept");
            let mut request = [0u8; 8192];
            let _ = socket.read(&mut request);
            let body = concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n",
                "data: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).expect("write response");
        });

        let config = LlmConfig {
            base_url: format!("http://{addr}/v1"),
            model: "mock".to_string(),
            api_key: String::new(),
            temperature: 0.5,
        };
        let mut events = Vec::new();
        stream_chat(
            &config,
            vec![ChatMessage {
                role: "user".to_string(),
                content: "在吗".to_string(),
            }],
            |event| events.push(event),
        )
        .await
        .expect("stream chat");
        server.join().expect("server join");

        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "delta")
                .map(|event| event.text.as_str())
                .collect::<Vec<_>>(),
            vec!["你", "好"]
        );
        assert!(events.iter().any(|event| event.kind == "done" && event.text == "你好"));
    }
}
