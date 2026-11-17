// Step 1 · Rust 侧流式 HTTP 技术自检
// 本地起一个 chunked HTTP/TCP echo 服务（不耗 API 额度），用 reqwest 流式读取，
// 测量首 chunk 延迟与总耗时，验证后续 LLM 流式调用所需的 Rust 链路。

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProbeResult {
    ok: bool,
    url: String,
    first_chunk_ms: u128,
    total_ms: u128,
    chunks: usize,
    bytes: usize,
    text: String,
    error: Option<String>,
}

fn spawn_local_server() -> Result<(String, thread::JoinHandle<()>), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(head.as_bytes());
            for part in ["刚洗完澡\n", "你呢\n", "早点睡吧\n", "晚安\n"] {
                let chunk = part.as_bytes();
                let _ = write!(stream, "{:X}\r\n", chunk.len());
                let _ = stream.write_all(chunk);
                let _ = stream.write_all(b"\r\n");
                let _ = stream.flush();
                thread::sleep(Duration::from_millis(30));
            }
            let _ = stream.write_all(b"0\r\n\r\n");
            let _ = stream.flush();
        }
    });
    Ok((format!("http://{}/stream", addr), handle))
}

#[tauri::command]
pub async fn http_stream_probe() -> Result<HttpProbeResult, String> {
    let (url, handle) = spawn_local_server()?;
    let t0 = Instant::now();
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut stream = resp.bytes_stream();
    let mut first: Option<u128> = None;
    let mut chunks = 0usize;
    let mut bytes = 0usize;
    let mut text = String::new();
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("stream: {e}"))?;
        if first.is_none() {
            first = Some(t0.elapsed().as_millis());
        }
        chunks += 1;
        bytes += chunk.len();
        text.push_str(&String::from_utf8_lossy(&chunk));
    }
    let _ = handle.join();
    let first_chunk_ms = first.unwrap_or(0);
    Ok(HttpProbeResult {
        ok: chunks >= 2 && first_chunk_ms < 500 && text.contains("刚洗完澡"),
        url,
        first_chunk_ms,
        total_ms: t0.elapsed().as_millis(),
        chunks,
        bytes,
        text,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn http_probe_passes() {
        let result = http_stream_probe().await.expect("http probe failed");
        assert!(
            result.ok,
            "probe not ok: chunks={} first={}ms text={:?}",
            result.chunks, result.first_chunk_ms, result.text
        );
        assert!(result.chunks >= 2);
        assert!(result.text.contains("刚洗完澡"));
        assert!(result.first_chunk_ms < 500);
    }
}
