// Step 2：聊天记录导入向导（选文件 → 解析 → 体检报告 → 完成）
import { adapterCatalog } from "@changzai/core";
import type { ReactElement } from "react";
import type { ImportState } from "../hooks/useImport.ts";
import type { DbStats } from "../lib/tauri.ts";
import { Icon } from "./Icons.tsx";

export interface ImportWizardProps {
  open: boolean;
  state: ImportState;
  canImport: boolean;
  dbStats: DbStats | null;
  onRun: () => void;
  onReset: () => void;
  onClose: () => void;
}

const ADAPTERS = adapterCatalog();

const FIDELITY_LABEL: Record<string, string> = {
  low: "轻度模式",
  medium: "标准模式",
  high: "高保真模式",
};

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatRatio(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ImportWizard({
  open,
  state,
  canImport,
  dbStats,
  onRun,
  onReset,
  onClose,
}: ImportWizardProps): ReactElement | null {
  if (!open) return null;
  const result = state.result;
  const report = result?.report;
  const level = report?.fidelity_level ?? "low";

  return (
    <div className="modal-root" role="presentation">
      <section className="modal-card import-wizard" role="dialog" aria-modal="true" aria-label="导入聊天记录">
        <header className="modal-head">
          <div>
            <h2>导入聊天记录</h2>
            <p className="settings-hint">支持 WeChatMsg / 留痕 / QQ 导出，也支持直接粘贴的文本。数据只在这台电脑上处理。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" title="关闭" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="modal-body">
          {(state.step === "idle" || state.step === "picking") && (
            <>
              <div className="import-formats">
                {ADAPTERS.map((adapter) => (
                  <div className="import-format" key={adapter.name}>
                    <strong>{adapter.name}</strong>
                    <span>{adapter.description}</span>
                  </div>
                ))}
              </div>
              <p className="settings-note">
                {dbStats?.ok && dbStats.messageCount > 0
                  ? `数据库里已有 ${formatNumber(dbStats.messageCount)} 条消息（ta 的 ${formatNumber(dbStats.herCount)} 条）。再次导入会按消息 ID 去重合并。`
                  : "第一次导入会建立本地加密数据库；导入前请先在微信电脑版导出聊天记录。"}
              </p>
              <p className="settings-warn">所有内容只在本机加密存储，不上传；holdout 会自动单独封存用于后续评测。</p>
              {!canImport && <p className="settings-warn">当前在浏览器里，请用桌面应用导入。</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canImport || state.step === "picking"}
                  onClick={onRun}
                >
                  {state.step === "picking" ? "正在选择…" : "选择聊天记录文件"}
                </button>
              </div>
              {state.message.length > 0 && state.step === "idle" && (
                <p className="settings-message bad">{state.message}</p>
              )}
            </>
          )}

          {state.step === "parsing" && (
            <>
              <div className="import-progress">
                <span className="spinner" aria-hidden />
                <p>{state.message || "正在解析…"}</p>
              </div>
              <p className="settings-hint">5 万条以内的记录通常在 90 秒内完成；解析完成后会显示体检报告。</p>
            </>
          )}

          {state.step === "error" && (
            <>
              <p className="settings-message bad">{state.message || "导入失败"}</p>
              {result?.warnings.map((warning) => (
                <p key={warning} className="settings-hint">
                  {warning}
                </p>
              ))}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>
                  关闭
                </button>
                <button type="button" className="btn primary" onClick={onRun}>
                  重试
                </button>
              </div>
            </>
          )}

          {state.step === "done" && report && result && (
            <>
              <div className="report-summary">
                <div className="report-item">
                  <span className="report-label">消息总数</span>
                  <strong className="report-value">{formatNumber(report.total_msgs)}</strong>
                </div>
                <div className="report-item">
                  <span className="report-label">ta 的消息</span>
                  <strong className="report-value">{formatNumber(report.her_msgs)}</strong>
                </div>
                <div className="report-item">
                  <span className="report-label">时间跨度</span>
                  <strong className="report-value">{formatNumber(report.span_days)} 天</strong>
                </div>
                <div className="report-item">
                  <span className="report-label">夜间对话</span>
                  <strong className="report-value">{formatRatio(report.night_ratio)}</strong>
                </div>
                <div className="report-item">
                  <span className="report-label">平均句长</span>
                  <strong className="report-value">{report.avg_len} 字</strong>
                </div>
                <div className="report-item">
                  <span className="report-label">还原度</span>
                  <strong className="report-value">
                    {report.fidelity_estimate} / 100
                    <em className="report-tag">{FIDELITY_LABEL[level] ?? level}</em>
                  </strong>
                </div>
              </div>

              <p className="report-advice">{report.advice}</p>
              <p className="settings-note">
                已写入 {formatNumber(result.messages.length)} 条，其中 {formatNumber(result.holdoutCount)} 条作为 holdout
                封存（不参与后续蒸馏，只用于评测）。
              </p>

              <div className="report-columns">
                <div>
                  <h4>识别到的文件</h4>
                  <ul className="usage-list">
                    {result.adapters.map((adapter) => (
                      <li key={adapter.sourceName}>
                        {adapter.sourceName} → {adapter.adapterName}（{adapter.parsedCount} 条）
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>需要注意</h4>
                  <ul className="usage-list">
                    {result.warnings.length > 0 ? (
                      result.warnings.map((warning) => <li key={warning}>{warning}</li>)
                    ) : (
                      <li>没有发现明显问题。</li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn" onClick={onReset}>
                  再导入一批
                </button>
                <button type="button" className="btn primary" onClick={onClose}>
                  完成
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
