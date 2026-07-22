"use client";

import { useState, type ChangeEvent } from "react";

interface Preview { notes: number; newNotes: number; existingNotes: number; customTerms: number; fingerprint: string }

export function DataTransfer() {
  const [document, setDocument] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setPreview(null); setMessage("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMessage("导入文件不能超过 10 MB。"); return; }
    const text = await file.text();
    setDocument(text); setPending(true);
    const response = await fetch("/api/v1/account/import/preview", { method: "POST", headers: { "content-type": "application/json" }, body: text });
    const result = await response.json(); setPending(false);
    if (response.ok) setPreview(result.data); else setMessage(result.error?.message ?? "无法读取导入文件。");
  }

  async function commit() {
    if (!preview || !window.confirm(`将导入 ${preview.newNotes} 条新笔记，并跳过 ${preview.existingNotes} 条已有笔记。继续吗？`)) return;
    setPending(true); setMessage("");
    const response = await fetch("/api/v1/account/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: document });
    const result = await response.json(); setPending(false);
    if (response.ok) { setMessage(`导入完成：新增 ${result.data.imported} 条，跳过 ${result.data.skipped} 条。`); setPreview(null); }
    else setMessage(result.error?.message ?? "导入失败，请稍后重试。");
  }

  return <section className="device-manager data-transfer" aria-labelledby="data-transfer-title">
    <div><span className="section-kicker">PORTABILITY</span><h3 id="data-transfer-title">备份与迁移</h3><p>导出完整 JSON 备份，或先预览再导入。重复导入会按笔记 ID 自动跳过，不会生成副本。</p></div>
    <div className="data-transfer__actions"><a className="primary-action" href="/api/v1/account/export">导出全部数据</a><label className="file-action">选择 JSON 备份<input accept="application/json,.json" disabled={pending} onChange={choose} type="file" /></label></div>
    {pending ? <p role="status">正在处理…</p> : null}
    {preview ? <div className="import-preview" role="status"><strong>导入预览</strong><span>新笔记 {preview.newNotes} 条 · 已存在 {preview.existingNotes} 条 · 自定义词汇 {preview.customTerms} 条</span><small>校验码 {preview.fingerprint}</small><button className="primary-action" type="button" onClick={commit}>确认导入</button></div> : null}
    {message ? <p className="form-message" role="status">{message}</p> : null}
  </section>;
}
