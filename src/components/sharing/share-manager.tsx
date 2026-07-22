"use client";

import { useState } from "react";
import type { NoteView } from "@/components/notes/types";

interface Share { id: string; expiresAt: string; revokedAt: string | null; viewCount: number }

export function ShareManager({ note }: { note: NoteView }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch(`/api/v1/shares?noteId=${note.id}`); if (response.ok) setShares((await response.json()).data); }
  async function create() { const response = await fetch("/api/v1/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ noteId: note.id, expiresInDays: 7, allowCopy: true, includeImage: true, includeSource: false }) }); const body = await response.json(); if (!response.ok) { setMessage(body.error?.message ?? "分享创建失败"); return; } const url = `${window.location.origin}/share/${body.data.token}`; await navigator.clipboard.writeText(url); setMessage("7 天有效的只读分享链接已复制。原始令牌只显示这一次。" ); await load(); }
  async function revoke(id: string) { const response = await fetch(`/api/v1/shares/${id}`, { method: "DELETE" }); if (response.ok) { setMessage("分享链接已撤销"); await load(); } }
  return <details className="share-manager" onToggle={(event) => { if (event.currentTarget.open && shares === null) void load(); }}><summary>只读分享</summary><p>分享仅包含这条提示词和你选择的预览内容，不会暴露账户或其他笔记。</p><button type="button" onClick={() => void create()}>创建 7 天分享并复制链接</button>{shares?.length ? <ul>{shares.map((share) => <li key={share.id}><span>{share.revokedAt ? "已撤销" : new Date(share.expiresAt) <= new Date() ? "已过期" : `有效 · ${share.viewCount} 次查看`}</span>{!share.revokedAt ? <button type="button" onClick={() => void revoke(share.id)}>撤销</button> : null}</li>)}</ul> : null}{message ? <p role="status">{message}</p> : null}</details>;
}
