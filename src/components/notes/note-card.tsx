"use client";

import Link from "next/link";
import { useState } from "react";

import { DefaultCover } from "./default-cover";
import type { NoteView } from "./types";

type NoteViewMode = "active" | "favorites" | "archived" | "trash";

export function NoteCard({ note, view, onOpen, onDeleted, onUpdated, selected = false, onSelect }: { note: NoteView; view: NoteViewMode; onOpen: () => void; onDeleted: (note: NoteView, deletedVersion: number) => void; onUpdated: (note: NoteView) => void; selected?: boolean; onSelect?: (selected: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [updating, setUpdating] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(note.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function remove() {
    if (!window.confirm(`确定把“${note.title}”移到回收站吗？`)) return;
    setDeleting(true);
    const response = await fetch(`/api/v1/notes/${note.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: note.version }),
    });
    setDeleting(false);
    if (response.ok) onDeleted(note, (await response.json()).data.version);
    else window.alert("删除失败，请刷新后重试。");
  }

  async function update(changes: Record<string, unknown>) {
    setUpdating(true);
    const response = await fetch(`/api/v1/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: note.version, ...changes }),
    });
    setUpdating(false);
    if (response.ok) onUpdated((await response.json()).data);
    else window.alert(response.status === 409 ? "这条笔记已在其他设备更新，请刷新后重试。" : "操作失败，请稍后重试。");
  }

  async function restore() {
    setUpdating(true);
    const response = await fetch(`/api/v1/notes/${note.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: note.version }),
    });
    setUpdating(false);
    if (response.ok) onUpdated((await response.json()).data);
    else window.alert("恢复失败，请刷新后重试。");
  }

  return (
    <article className="prompt-card">
      {onSelect ? <label className="prompt-card__select"><input checked={selected} type="checkbox" onChange={(event) => onSelect(event.target.checked)} />选择</label> : null}
      <button className="prompt-card__visual" type="button" onClick={onOpen} aria-label={`预览 ${note.title}`}>
        {note.coverImage && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={note.coverImage.thumbnailUrl} alt={note.title} loading="lazy" onError={() => setImageFailed(true)} />
        ) : <DefaultCover />}
      </button>
      <div className="prompt-card__content">
        <div className="prompt-card__copy">
          <h3>{note.title}</h3>
          <p>{note.prompt.slice(0, 150)}{note.prompt.length > 150 ? "…" : ""}</p>
          <div className="tag-list" aria-label="提示词标签">
            {note.tags.map((tag) => <Link key={tag.id} href={`/tags/${tag.id}`}>{tag.name}</Link>)}
          </div>
        </div>
        <footer className="prompt-card__actions">
          <button type="button" onClick={copyPrompt}>{copied ? "已复制" : "复制"}</button>
          {view === "trash" ? <button disabled={updating} type="button" onClick={restore}>{updating ? "恢复中" : "恢复"}</button> : <>
            <button aria-pressed={note.favorite} disabled={updating} type="button" onClick={() => void update({ favorite: !note.favorite })}>{note.favorite ? "取消收藏" : "收藏"}</button>
            <button disabled={updating} type="button" onClick={() => void update({ archivedAt: note.archivedAt ? null : new Date().toISOString() })}>{note.archivedAt ? "移出归档" : "归档"}</button>
            <Link href={`/notes/${note.id}/edit`}>编辑</Link>
            <button className="danger-action" disabled={deleting || updating} type="button" onClick={remove}>{deleting ? "删除中" : "删除"}</button>
          </>}
        </footer>
      </div>
    </article>
  );
}
