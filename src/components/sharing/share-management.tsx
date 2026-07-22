"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DefaultCover } from "@/components/notes/default-cover";

interface ActiveShare {
  id: string;
  noteId: string;
  title: string;
  previewImageUrl: string | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function ShareManagement() {
  const [shares, setShares] = useState<ActiveShare[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/shares", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取分享列表");
    setShares((await response.json()).data);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(() => {
        setShares([]);
        setMessage("分享列表加载失败，请刷新页面重试。");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function renew(share: ActiveShare) {
    if (pendingId) return;
    setPendingId(share.id);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/shares/${share.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "renew" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "续期失败");
      setShares((current) => current?.map((item) => item.id === share.id ? { ...item, expiresAt: body.data.expiresAt } : item) ?? []);
      setMessage(`“${share.title}”已续期 7 天。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "续期失败");
    } finally {
      setPendingId(null);
    }
  }

  async function close(share: ActiveShare) {
    if (pendingId) return;
    setPendingId(share.id);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/shares/${share.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "关闭分享失败");
      setShares((current) => current?.filter((item) => item.id !== share.id) ?? []);
      setMessage(`“${share.title}”的分享已关闭。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关闭分享失败");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="share-list" aria-busy={shares === null}>
      {message ? <p className="share-list__message" role="status">{message}</p> : null}
      {shares === null ? <div className="gallery-state">正在读取有效分享…</div> : null}
      {shares?.length ? (
        <div className="share-table-wrap">
          <table>
            <thead><tr><th>预览图</th><th>提示词标题</th><th>分享日期</th><th>过期日期</th><th>续期</th><th>关闭</th></tr></thead>
            <tbody>{shares.map((share) => {
              const pending = pendingId === share.id;
              return <tr key={share.id}>
                <td data-label="预览图"><div className="share-list__preview">{share.previewImageUrl ? <>
                  <span className="sr-only">{share.title} 的预览图</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={share.previewImageUrl} alt="" />
                </> : <DefaultCover />}</div></td>
                <td data-label="提示词标题"><Link href={`/notes/${share.noteId}/edit`}><strong>{share.title}</strong><small>{share.viewCount} 次查看</small></Link></td>
                <td data-label="分享日期"><time dateTime={share.createdAt}>{formatDate(share.createdAt)}</time></td>
                <td data-label="过期日期"><time dateTime={share.expiresAt}>{formatDate(share.expiresAt)}</time></td>
                <td data-label="续期"><button type="button" disabled={pendingId !== null} onClick={() => void renew(share)}>{pending ? "处理中…" : "续期 7 天"}</button></td>
                <td data-label="关闭"><button className="danger-action" type="button" disabled={pendingId !== null} onClick={() => void close(share)}>{pending ? "处理中…" : "立即关闭"}</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : null}
      {shares?.length === 0 ? <div className="gallery-state">目前没有有效的提示词分享。已关闭或已过期的分享会自动从这里消失。</div> : null}
    </section>
  );
}
