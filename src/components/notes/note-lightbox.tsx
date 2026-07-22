"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { DefaultCover } from "./default-cover";
import { HistoryPanel } from "./history-panel";
import { ShareManager } from "@/components/sharing/share-manager";
import type { NoteView } from "./types";

export function NoteLightbox({ note, view, onClose, onDeleted, onUpdated }: { note: NoteView; view: "active" | "favorites" | "archived" | "trash"; onClose: () => void; onDeleted: (note: NoteView, deletedVersion: number) => void; onUpdated: (note: NoteView) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const image = note.images[imageIndex] ?? null;

  useEffect(() => {
    closeRef.current?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", escape);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", escape); document.body.style.overflow = ""; };
  }, [onClose]);

  async function remove() {
    if (!window.confirm(`确定删除“${note.title}”吗？`)) return;
    const response = await fetch(`/api/v1/notes/${note.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: note.version }) });
    if (response.ok) { onDeleted(note, (await response.json()).data.version); onClose(); }
  }

  async function update(changes: Record<string, unknown>) {
    const response = await fetch(`/api/v1/notes/${note.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: note.version, ...changes }) });
    if (response.ok) onUpdated((await response.json()).data); else window.alert("操作失败，请刷新后重试。");
  }

  async function restore() {
    const response = await fetch(`/api/v1/notes/${note.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: note.version }) });
    if (response.ok) onUpdated((await response.json()).data); else window.alert("恢复失败，请刷新后重试。");
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-labelledby="lightbox-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div ref={panelRef} className="lightbox__panel">
        <button ref={closeRef} className="lightbox__close" type="button" onClick={onClose} aria-label="关闭预览">×</button>
        <div className="lightbox__media">
          {image && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.displayUrl} alt={note.title} onError={() => setImageFailed(true)} />
          ) : <DefaultCover />}
          {note.images.length > 1 ? <div className="lightbox__pager">
            <button type="button" onClick={() => { setImageFailed(false); setImageIndex((imageIndex - 1 + note.images.length) % note.images.length); }}>上一张</button>
            <span>{imageIndex + 1} / {note.images.length}</span>
            <button type="button" onClick={() => { setImageFailed(false); setImageIndex((imageIndex + 1) % note.images.length); }}>下一张</button>
          </div> : null}
        </div>
        <div className="lightbox__details">
          <div>
            <span className="section-kicker">PROMPT DETAIL</span>
            <h2 id="lightbox-title">{note.title}</h2>
          </div>
          <div className="tag-list">{note.tags.map((tag) => <Link key={tag.id} href={`/tags/${tag.id}`}>{tag.name}</Link>)}</div>
          {note.sourceUrl ? <a className="note-source" href={note.sourceUrl} target="_blank" rel="noopener noreferrer"><span>来源</span><strong>{note.sourceTitle || new URL(note.sourceUrl).hostname}</strong><small>{new URL(note.sourceUrl).hostname} · 新窗口打开</small></a> : null}
          <div className="lightbox__prompt"><pre>{note.prompt}</pre></div>
          {note.negativePrompt ? <div><h3>负面提示词</h3><pre>{note.negativePrompt}</pre></div> : null}
          {view !== "trash" ? <HistoryPanel note={note} onRestored={onUpdated} /> : null}
          {view !== "trash" ? <ShareManager note={note} /> : null}
          <div className="lightbox__actions">
            <button type="button" onClick={() => navigator.clipboard.writeText(note.prompt)}>复制完整提示词</button>
            {view !== "trash" ? <Link href={`/imagehub?note=${note.id}`}>在 AI ImageHub 测试</Link> : null}
            {view === "trash" ? <button type="button" onClick={restore}>恢复提示词</button> : <>
              <button aria-pressed={note.favorite} type="button" onClick={() => void update({ favorite: !note.favorite })}>{note.favorite ? "取消收藏" : "收藏"}</button>
              <button type="button" onClick={() => void update({ archivedAt: note.archivedAt ? null : new Date().toISOString() })}>{note.archivedAt ? "移出归档" : "归档"}</button>
              <Link href={`/notes/${note.id}/edit`}>编辑</Link>
              <Link href={`/notes/new?duplicate=${note.id}`}>复制为新提示词</Link>
              <button className="danger-action" type="button" onClick={remove}>删除</button>
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}
