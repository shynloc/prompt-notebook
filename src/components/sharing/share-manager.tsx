"use client";

import { useCallback, useEffect, useState } from "react";

import type { NoteView } from "@/components/notes/types";

interface Share {
  id: string;
  token: string | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
}

type PendingAction = "create" | "copy" | "renew" | "revoke" | null;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function ShareManager({ note }: { note: NoteView }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const [manualLink, setManualLink] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/shares?noteId=${note.id}`, { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取分享状态");
    setShares((await response.json()).data);
  }, [note.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShares(null);
      setMessage("");
      setManualLink("");
      void load().catch(() => {
        setShares([]);
        setMessage("暂时无法读取分享状态，请稍后重试。");
        setFeedback("error");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function showFeedback(nextMessage: string, state: "success" | "error") {
    setMessage(nextMessage);
    setFeedback(state);
    window.setTimeout(() => setFeedback("idle"), 2200);
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setManualLink("");
      showFeedback("分享链接已复制，可以直接发送给朋友。", "success");
    } catch {
      setManualLink(url);
      showFeedback("链接已创建，请在下方手动复制。", "success");
    }
  }

  async function createOrCopy() {
    if (pending) return;
    const active = shares?.[0];
    if (active?.token) {
      setPending("copy");
      await copyLink(active.token);
      setPending(null);
      return;
    }

    setPending("create");
    setMessage("");
    setManualLink("");
    try {
      const response = await fetch("/api/v1/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noteId: note.id,
          expiresInDays: 7,
          allowCopy: true,
          includeImage: true,
          includeSource: false,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "分享创建失败");
      await copyLink(body.data.token);
      await load();
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "分享创建失败", "error");
    } finally {
      setPending(null);
    }
  }

  async function renew(id: string) {
    if (pending) return;
    setPending("renew");
    try {
      const response = await fetch(`/api/v1/shares/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "renew" }),
      });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "续期失败");
      await load();
      showFeedback("分享已续期 7 天。", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "续期失败", "error");
    } finally {
      setPending(null);
    }
  }

  async function revoke(id: string) {
    if (pending) return;
    setPending("revoke");
    try {
      const response = await fetch(`/api/v1/shares/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "关闭分享失败");
      setShares([]);
      setManualLink("");
      showFeedback("分享已关闭，原链接立即失效。", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "关闭分享失败", "error");
    } finally {
      setPending(null);
    }
  }

  const active = shares?.[0];
  return (
    <section className="share-manager" data-feedback={feedback} aria-busy={pending !== null}>
      <div className="share-manager__heading">
        <div>
          <span className="section-kicker">SHARE</span>
          <strong>{active ? "这条提示词正在分享" : "分享这条提示词"}</strong>
        </div>
        {active ? <span className="share-manager__live">● 分享中</span> : null}
      </div>
      {active ? (
        <p className="share-manager__dates">
          分享始于 {formatDate(active.createdAt)} · 过期于 {formatDate(active.expiresAt)} · {active.viewCount} 次查看
        </p>
      ) : (
        <p>创建一个 7 天有效的只读链接，不会暴露你的账户或其他笔记。</p>
      )}
      <div className="share-manager__actions">
        <button className="share-manager__primary" type="button" disabled={pending !== null || shares === null} onClick={() => void createOrCopy()}>
          {pending === "create" ? <><span className="button-spinner" aria-hidden="true" />正在创建分享…</> : pending === "copy" ? "正在复制…" : active?.token ? "复制分享链接" : "创建 7 天分享并复制链接"}
        </button>
        {active ? <button type="button" disabled={pending !== null} onClick={() => void renew(active.id)}>{pending === "renew" ? "续期中…" : "续期 7 天"}</button> : null}
        {active ? <button className="danger-action" type="button" disabled={pending !== null} onClick={() => void revoke(active.id)}>{pending === "revoke" ? "关闭中…" : "关闭分享"}</button> : null}
      </div>
      {manualLink ? <label className="share-manager__manual">手动复制链接<input readOnly value={manualLink} onFocus={(event) => event.currentTarget.select()} /></label> : null}
      {message ? <p className="share-manager__message" role="status">{feedback === "success" ? "✓ " : feedback === "error" ? "! " : ""}{message}</p> : null}
    </section>
  );
}
