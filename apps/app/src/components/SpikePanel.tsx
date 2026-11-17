import { useState } from "react";
import type { ReactElement } from "react";
import { api, isTauri, type AppInfo, type DbProbeResult, type HttpProbeResult, type NotifyProbeResult } from "../lib/tauri.ts";

type SpikeKey = "env" | "db" | "http" | "notify";

interface SpikeState {
  loading: boolean;
  ok: boolean | null;
  title: string;
  detail: string;
}

const initial: Record<SpikeKey, SpikeState> = {
  env: { loading: false, ok: null, title: "环境", detail: "Windows / Tauri / WebView2 / 版本" },
  db: { loading: false, ok: null, title: "SQLCipher + FTS5", detail: "加密建库、错误密码、trigram 中文检索、Argon2id" },
  http: { loading: false, ok: null, title: "Rust 流式 HTTP", detail: "本地 chunked echo：首 chunk 延迟 / 取消" },
  notify: { loading: false, ok: null, title: "托盘 + Windows 通知", detail: "常驻托盘、通知投递" },
};

function fmt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function SpikePanel(): ReactElement {
  const [states, setStates] = useState(initial);
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const tauri = isTauri();

  async function run(key: SpikeKey): Promise<void> {
    setStates((s) => ({ ...s, [key]: { ...s[key], loading: true } }));
    try {
      let ok = false;
      let payload: unknown;
      if (key === "env") {
        const info: AppInfo = await api.appInfo();
        ok = Boolean(info.version);
        payload = info;
      } else if (key === "db") {
        const r: DbProbeResult = await api.dbProbe();
        ok = r.ok;
        payload = r;
      } else if (key === "http") {
        const r: HttpProbeResult = await api.httpProbe();
        ok = r.ok;
        payload = r;
      } else {
        const r: NotifyProbeResult = await api.notifyProbe();
        ok = r.ok;
        payload = r;
      }
      setRaw((r) => ({ ...r, [key]: payload }));
      setStates((s) => ({ ...s, [key]: { ...s[key], loading: false, ok } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRaw((r) => ({ ...r, [key]: { error: message } }));
      setStates((s) => ({ ...s, [key]: { ...s[key], loading: false, ok: false } }));
    }
  }

  async function runAll(): Promise<void> {
    for (const key of ["env", "db", "http", "notify"] as SpikeKey[]) {
      // 串行：避免同时编译/占用，也方便看日志
      await run(key);
    }
  }

  return (
    <section className="spike-panel" aria-label="技术底座自检">
      <header className="spike-head">
        <div>
          <h2>Step 1 · 技术底座自检</h2>
          <p className="muted">
            {tauri ? "Tauri 桌面环境已连接" : "浏览器模式：请用 pnpm dev 启动桌面应用"}
          </p>
        </div>
        <button className="btn primary" onClick={() => void runAll()} disabled={!tauri}>
          全部运行
        </button>
      </header>

      <div className="spike-list">
        {(Object.keys(states) as SpikeKey[]).map((key) => {
          const st = states[key];
          return (
            <article className="spike-card" key={key}>
              <div className="spike-card-head">
                <div>
                  <h3>{st.title}</h3>
                  <p className="muted small">{st.detail}</p>
                </div>
                <button className="btn" onClick={() => void run(key)} disabled={!tauri || st.loading}>
                  {st.loading ? "运行中…" : "运行"}
                </button>
              </div>
              <div className={`spike-status ${st.ok === null ? "" : st.ok ? "ok" : "bad"}`}>
                {st.ok === null ? "未运行" : st.ok ? "通过" : "失败"}
              </div>
              {raw[key] !== undefined && <pre className="spike-raw">{fmt(raw[key])}</pre>}
            </article>
          );
        })}
      </div>

      <p className="footnote">
        说明：SQLCipher 探测会在临时目录创建加密库并验证文件头不可读；FTS5 用 trigram 建索引检索中文；
        HTTP 探测使用本地回环 SSE，不消耗 API 额度。
      </p>
    </section>
  );
}
