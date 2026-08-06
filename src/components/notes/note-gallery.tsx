"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { NoteCard } from "./note-card";
import { BulkToolbar } from "./bulk-toolbar";
import { NoteLightbox } from "./note-lightbox";
import { AdvancedFilters, type AdvancedFilterValue } from "./advanced-filters";
import type { NoteView } from "./types";

type GalleryView = "active" | "favorites" | "archived" | "trash";

export function NoteGallery({ characterProfileId, tagId, view = "active", heading = "提示词作品库", intro = "把提示词、标签和生成作品放在同一个可跨设备同步的笔记本里。" }: { characterProfileId?: string; tagId?: string; view?: GalleryView; heading?: string; intro?: string }) {
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "error">("loading");
  const [selected, setSelected] = useState<NoteView | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState<{ note: NoteView; version: number } | null>(null);
  const [imageFilter, setImageFilter] = useState<"all" | "with" | "without">("all");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedFilterValue>({ field: "all", sourceHost: "", dateFrom: "", dateTo: "", projectId: "" });

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(new URLSearchParams(window.location.search).get("q") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async (cursor?: string) => {
    const more = Boolean(cursor);
    setState("loading");
    const params = new URLSearchParams({ limit: "60" });
    if (debounced) params.set("q", debounced);
    if (tagId) params.set("tagId", tagId);
    if (characterProfileId) params.set("characterProfileId", characterProfileId);
    if (view === "favorites") params.set("favorite", "true");
    else if (view !== "active") params.set("view", view);
    if (imageFilter !== "all") params.set("hasImage", imageFilter === "with" ? "true" : "false");
    params.set("sort", sort);
    if (advanced.field !== "all") params.set("field", advanced.field);
    if (advanced.sourceHost) params.set("sourceHost", advanced.sourceHost);
    if (advanced.dateFrom) params.set("dateFrom", advanced.dateFrom);
    if (advanced.dateTo) params.set("dateTo", `${advanced.dateTo}T23:59:59.999Z`);
    if (advanced.projectId) params.set("projectId", advanced.projectId);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/v1/notes?${params}`, { cache: "no-store" });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (!response.ok) throw new Error();
      const body = await response.json();
      setNotes((items) => more ? [...items, ...body.data] : body.data);
      setNextCursor(body.meta?.nextCursor ?? null);
      setState("ready");
    } catch { setState("error"); }
  }, [advanced, characterProfileId, debounced, imageFilter, sort, tagId, view]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (debounced) url.searchParams.set("q", debounced); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [debounced]);

  function deleted(note: NoteView, version: number) { setNotes((items) => items.filter((item) => item.id !== note.id)); setRecentlyDeleted({ note, version }); }

  function updated(note: NoteView) {
    const shouldRemain = view === "trash" ? Boolean(note.deletedAt)
      : view === "archived" ? Boolean(note.archivedAt)
        : view === "favorites" ? note.favorite && !note.archivedAt
          : !note.archivedAt;
    setNotes((items) => shouldRemain ? items.map((item) => item.id === note.id ? note : item) : items.filter((item) => item.id !== note.id));
    if (selected?.id === note.id) setSelected(shouldRemain ? note : null);
  }

  async function restore() {
    if (!recentlyDeleted) return;
    const response = await fetch(`/api/v1/notes/${recentlyDeleted.note.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: recentlyDeleted.version }) });
    if (!response.ok) { window.alert("恢复失败，请刷新后重试。"); return; }
    const restored = (await response.json()).data;
    if (view !== "trash") setNotes((items) => [restored, ...items]);
    setRecentlyDeleted(null);
  }

  return (
    <section className="notebook-page">
      <header className="notebook-heading">
        <div><span className="section-kicker">VISUAL NOTEBOOK</span><h2>{heading}</h2><p>{intro}</p></div>
      </header>
      <label className="search-box">
        <span aria-hidden="true">⌕</span>
        <span className="sr-only">搜索提示词</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、提示词内容或标签…" type="search" />
        {query ? <button type="button" onClick={() => setQuery("")}>清除</button> : null}
      </label>
      <AdvancedFilters value={advanced} query={debounced} onChange={setAdvanced} />
      <div className="gallery-toolbar" aria-label="作品库筛选与排序">
        <label>图片<select value={imageFilter} onChange={(event) => setImageFilter(event.target.value as typeof imageFilter)}><option value="all">全部</option><option value="with">有预览图</option><option value="without">无预览图</option></select></label>
        <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">最近更新</option><option value="title">标题 A–Z</option></select></label>
      </div>
      {view !== "trash" ? <BulkToolbar ids={selectedIds} onClear={() => setSelectedIds([])} onDone={() => void load()} /> : null}
      <div className="prompt-grid" aria-live="polite" aria-busy={state === "loading"}>
        {state === "loading" ? <div className="gallery-state">正在整理你的提示词…</div> : null}
        {state === "unauthenticated" ? <div className="gallery-state gallery-state--onboarding"><strong>登录后，让每条提示词都真正保存下来</strong><p>在电脑、手机和 Chrome 扩展之间同步笔记、标签与作品预览图。</p><Link className="primary-action" href="/sign-in">登录或创建账户</Link></div> : null}
        {state === "error" ? <div className="gallery-state">暂时无法读取笔记。<button type="button" onClick={() => void load()}>重试</button></div> : null}
        {state === "ready" && notes.length === 0 ? <div className="gallery-state">{query ? "没有找到匹配的提示词。" : "还没有提示词，创建第一张作品卡片吧。"}</div> : null}
        {state === "ready" ? notes.map((note) => <NoteCard key={note.id} note={note} view={view} onOpen={() => setSelected(note)} onDeleted={deleted} onUpdated={updated} selected={selectedIds.includes(note.id)} onSelect={view === "trash" ? undefined : (checked) => setSelectedIds((ids) => checked ? [...new Set([...ids, note.id])] : ids.filter((id) => id !== note.id))} />) : null}
        {state === "ready" && nextCursor ? <button className="load-more" type="button" onClick={() => void load(nextCursor)}>加载更多</button> : null}
      </div>
      {selected ? <NoteLightbox key={selected.id} note={selected} view={view} onClose={() => setSelected(null)} onDeleted={deleted} onUpdated={updated} /> : null}
      {recentlyDeleted ? <div className="undo-toast" role="status"><span>已将“{recentlyDeleted.note.title}”移到回收状态</span><button type="button" onClick={restore}>撤销删除</button><button type="button" onClick={() => setRecentlyDeleted(null)} aria-label="关闭提示">×</button></div> : null}
    </section>
  );
}
