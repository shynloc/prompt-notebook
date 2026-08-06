"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CharacterCard } from "./character-card";
import { confirmPermanentCharacterDeletion } from "./permanent-delete-confirmation";
import {
  characterApiMessage,
  type CharacterLibraryView,
  type CharacterProfile,
} from "./types";

const viewLabels: Record<CharacterLibraryView, string> = {
  active: "使用中",
  archived: "已归档",
  trash: "回收站",
};

export function CharacterLibrary() {
  const requestSequence = useRef(0);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [view, setView] = useState<CharacterLibraryView>("active");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [useCase, setUseCase] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (cursor?: string) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const more = Boolean(cursor);
    if (more) setLoadingMore(true); else setState("loading");
    const params = new URLSearchParams({ limit: "24", view });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (useCase) params.set("useCase", useCase);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/v1/ai-models?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (sequence !== requestSequence.current) return;
      if (response.status === 401) {
        window.location.assign("/sign-in?returnTo=/ai-models");
        return;
      }
      if (!response.ok) throw new Error(characterApiMessage(body, "读取失败"));
      setProfiles((current) => more ? [...current, ...body.data] : body.data);
      setNextCursor(body.meta?.nextCursor ?? null);
      setState("ready");
    } catch {
      if (sequence !== requestSequence.current) return;
      if (!more) setState("error");
      setMessage("暂时无法读取 AI Model 资产，请检查网络后重试。");
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, useCase, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const availableUseCases = useMemo(
    () => [...new Set(profiles.flatMap((profile) => profile.useCases))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [profiles],
  );

  async function archive(profile: CharacterProfile, archived: boolean) {
    setPendingId(profile.id);
    setMessage(archived ? `正在归档“${profile.name}”…` : `正在恢复“${profile.name}”…`);
    try {
      const response = await fetch(`/api/v1/ai-models/${profile.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: profile.version, archivedAt: archived ? new Date().toISOString() : null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "状态更新失败，请刷新后重试。"));
        return;
      }
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setMessage(archived ? "AI Model 已归档，不再出现在生图选择器中。" : "AI Model 已恢复到使用中的资产库。");
    } catch {
      setMessage("无法连接云端，角色状态没有改变。");
    } finally {
      setPendingId(null);
    }
  }

  async function trash(profile: CharacterProfile) {
    if (!window.confirm(`将 AI Model“${profile.name}”移到回收站？关联提示词不会被删除。`)) return;
    setPendingId(profile.id);
    setMessage(`正在将“${profile.name}”移到回收站…`);
    try {
      const response = await fetch(`/api/v1/ai-models/${profile.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: profile.version }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "移入回收站失败，请刷新后重试。"));
        return;
      }
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setMessage("AI Model 已移入回收站，关联提示词和图片引用仍然保留。");
    } catch {
      setMessage("无法连接云端，角色没有被移入回收站。");
    } finally {
      setPendingId(null);
    }
  }

  async function restore(profile: CharacterProfile) {
    setPendingId(profile.id);
    setMessage(`正在恢复“${profile.name}”…`);
    try {
      const response = await fetch(`/api/v1/ai-models/${profile.id}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: profile.version }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "恢复失败，请刷新后重试。"));
        return;
      }
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setMessage("AI Model 已从回收站恢复到资产库。");
    } catch {
      setMessage("无法连接云端，角色尚未恢复。");
    } finally {
      setPendingId(null);
    }
  }

  async function permanentlyDelete(profile: CharacterProfile) {
    const confirmation = confirmPermanentCharacterDeletion(profile.name);
    if (confirmation === "cancelled") return;
    if (confirmation === "mismatch") {
      setMessage("输入的角色名称不匹配，永久删除已取消，数据没有变化。");
      return;
    }

    setPendingId(profile.id);
    setMessage(`正在永久删除“${profile.name}”…外部图床原文件不会自动删除。`);
    try {
      const response = await fetch(`/api/v1/ai-models/${profile.id}?mode=permanent`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: profile.version }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "永久删除失败，角色数据仍然保留，请刷新后重试。"));
        return;
      }
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setMessage(`“${profile.name}”已从 Prompt Notebook 永久删除。外部图床原文件未被删除，如需清理请前往图床管理。`);
    } catch {
      setMessage("无法连接云端，角色数据没有被永久删除，请检查网络后重试。");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="character-library">
      <header className="character-page-heading">
        <div><span className="section-kicker">AI MODEL / CASTING FILES</span><h2>AI 模特资产库</h2><p>集中管理可复用的角色设定、封面、主图和多视角参考图。</p></div>
        <Link className="primary-action" href="/ai-models/new">＋ 新建 AI Model</Link>
      </header>

      <nav className="character-view-tabs" aria-label="AI Model 状态">
        {(Object.keys(viewLabels) as CharacterLibraryView[]).map((item) => <button aria-current={view === item ? "page" : undefined} key={item} type="button" onClick={() => { setView(item); setUseCase(""); setProfiles([]); setState("loading"); setMessage(""); }}>{viewLabels[item]}</button>)}
      </nav>

      <div className="character-library-tools">
        <label className="search-box"><span aria-hidden="true">⌕</span><span className="sr-only">搜索 AI Model</span><input aria-label="搜索 AI Model" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、定位或角色设定…" />{query ? <button type="button" onClick={() => setQuery("")}>清除</button> : null}</label>
        <label>用途方向<select aria-label="按用途方向筛选" value={useCase} onChange={(event) => setUseCase(event.target.value)}><option value="">全部用途</option>{availableUseCases.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>

      {message ? <p className="character-library-message" role="status" aria-live="polite">{message}</p> : null}

      <div className="character-grid" aria-busy={state === "loading"} aria-live="polite">
        {state === "loading" ? <div className="character-library-state" role="status">正在整理 AI Model 档案…</div> : null}
        {state === "error" ? <div className="character-library-state"><strong>资产库暂时无法打开</strong><p>你的云端数据没有改变。</p><button type="button" onClick={() => void load()}>重新载入</button></div> : null}
        {state === "ready" && !profiles.length ? <div className="character-library-state"><span>NO CASTING FILES</span><strong>{debouncedQuery || useCase ? "没有匹配的 AI Model" : view === "active" ? "创建第一张角色卡" : view === "archived" ? "没有已归档角色" : "回收站是空的"}</strong><p>{view === "active" && !debouncedQuery && !useCase ? "建立角色后，可以在提示词和 AI ImageHub 中重复使用。" : "更换筛选条件或返回其他状态查看。"}</p>{view === "active" && !debouncedQuery && !useCase ? <Link className="primary-action" href="/ai-models/new">新建 AI Model</Link> : null}</div> : null}
        {state === "ready" ? profiles.map((profile) => <CharacterCard key={profile.id} profile={profile} view={view} pending={pendingId === profile.id} onArchive={(item, archived) => void archive(item, archived)} onTrash={(item) => void trash(item)} onRestore={(item) => void restore(item)} onPermanentDelete={(item) => void permanentlyDelete(item)} />) : null}
        {state === "ready" && nextCursor ? <button className="character-load-more" disabled={loadingMore} type="button" onClick={() => void load(nextCursor)}>{loadingMore ? "正在加载…" : "加载更多角色"}</button> : null}
      </div>
    </section>
  );
}
