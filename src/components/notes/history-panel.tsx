"use client";

import { useState } from "react";
import type { NoteView } from "./types";

interface Version { id: string; version: number; createdAt: string; snapshot: { title?: string; prompt?: string } }

export function HistoryPanel({ note, onRestored }: { note: NoteView; onRestored: (note: NoteView) => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch(`/api/v1/notes/${note.id}/versions`); if (response.ok) setVersions((await response.json()).data); }
  async function restore(version: Version) {
    if (!window.confirm(`恢复到版本 ${version.version}？当前版本会先保存到历史记录。`)) return;
    const response = await fetch(`/api/v1/notes/${note.id}/versions/${version.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: note.version }) });
    if (!response.ok) { setMessage(response.status === 409 ? "笔记已在其他设备更新，请刷新后重试。" : "恢复失败"); return; }
    const detail = await fetch(`/api/v1/notes/${note.id}`);
    if (detail.ok) onRestored((await detail.json()).data);
    setMessage("历史版本已恢复"); await load();
  }
  return <details className="history-panel" onToggle={(event) => { if (event.currentTarget.open && versions === null) void load(); }}><summary>版本历史</summary>{versions === null ? <p>展开后读取历史版本。</p> : versions.length ? <ol>{versions.map((version) => <li key={version.id}><div><strong>版本 {version.version} · {version.snapshot.title}</strong><small>{new Date(version.createdAt).toLocaleString("zh-CN")}</small></div><button type="button" onClick={() => void restore(version)}>恢复</button></li>)}</ol> : <p>保存一次修改后，这里会出现历史版本。</p>}{message ? <p role="status">{message}</p> : null}</details>;
}
