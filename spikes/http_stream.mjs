// 常在 · Step 1 spike：OpenAI 兼容流式响应（本地 SSE echo）
// 目的：验证流式解析、首 chunk 延迟、取消（AbortController）路径。
// 不访问外网，不消耗 API 额度；后续把 base_url 换成真实端点即可复用同一解析器。
// 运行：node spikes/http_stream.mjs --out spikes/results/http-stream.json
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : "spikes/results/http-stream.json";

const CHUNKS = [
  "刚", "洗完", "澡", "，", "你", "呢", "？", "我", "今天", "有点", "累", "，",
  "不过", "还行", "。", "你", "早点", "睡", "。",
];

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/v1/chat/completions") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        let i = 0;
        const timer = setInterval(() => {
          if (i < CHUNKS.length) {
            const payload = {
              id: "chatcmpl-probe",
              object: "chat.completion.chunk",
              choices: [{ delta: { content: CHUNKS[i] }, index: 0, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            i++;
          } else {
            res.write("data: [DONE]\n\n");
            res.end();
            clearInterval(timer);
          }
        }, 35);
        req.on("close", () => clearInterval(timer));
      } else if (req.url === "/v1/slow") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const t = setTimeout(() => {
          res.write("data: never\n\n");
          res.end();
        }, 3000);
        req.on("close", () => clearTimeout(t));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function runStream(base) {
  const t0 = performance.now();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "probe", stream: true, messages: [{ role: "user", content: "在干嘛" }] }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstChunkMs = null;
  let chunks = 0;
  let text = "";
  let ttfbMs = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfbMs === null) ttfbMs = performance.now() - t0;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 2);
      if (!frame.startsWith("data:")) continue;
      const data = frame.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const obj = JSON.parse(data);
        const delta = obj?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          if (firstChunkMs === null) firstChunkMs = performance.now() - t0;
          chunks++;
          text += delta;
        }
      } catch {
        /* 忽略不完整帧 */
      }
    }
  }
  const totalMs = performance.now() - t0;
  return { ttfbMs, firstChunkMs, totalMs, chunks, text };
}

async function runAbort(base) {
  const ctrl = new AbortController();
  const t0 = performance.now();
  const p = fetch(`${base}/v1/slow`, { signal: ctrl.signal }).then((r) => r.text());
  setTimeout(() => ctrl.abort(), 300);
  try {
    await p;
    return { abortOk: false, abortMs: null, reason: "请求未被取消" };
  } catch (e) {
    return { abortOk: e?.name === "AbortError", abortMs: performance.now() - t0, reason: e?.name ?? String(e) };
  }
}

const server = await startServer();
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const stream = await runStream(base);
const abort = await runAbort(base);
server.close();

const result = {
  ok: true,
  generatedAt: new Date().toISOString(),
  node: process.version,
  firstChunkMs: stream.firstChunkMs === null ? null : Math.round(stream.firstChunkMs),
  ttfbMs: Math.round(stream.ttfbMs ?? 0),
  totalMs: Math.round(stream.totalMs),
  chunks: stream.chunks,
  text: stream.text,
  expectedText: CHUNKS.join(""),
  textMatched: stream.text === CHUNKS.join(""),
  abortOk: abort.abortOk,
  abortMs: abort.abortMs === null ? null : Math.round(abort.abortMs),
  abortReason: abort.reason,
  note: "本地 SSE echo，不消耗 API；真实端点复用同一 SSE 解析与 AbortController 路径",
};

fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
