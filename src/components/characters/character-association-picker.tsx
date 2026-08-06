"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CharacterProfile } from "./types";

export type CharacterAssociationValue = Array<{
  id: string;
  role: "primary" | "supporting" | "reference";
  sortOrder: number;
}>;

export interface CharacterAssociationSeedProfile {
  id: string;
  name: string;
  summary?: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
  avatar?: {
    thumbnailUrl: string;
    displayUrl?: string;
    focusX: number;
    focusY: number;
  } | null;
  coverImage?: {
    thumbnailUrl: string;
    displayUrl?: string;
    focusX: number;
    focusY: number;
  } | null;
}

interface KnownCharacterProfile {
  id: string;
  name: string;
  summary: string;
  useCases: string[];
  archivedAt: string | null;
  deletedAt: string | null;
  portrait: CharacterAssociationSeedProfile["avatar"];
}

function normalizeProfile(profile: CharacterProfile | CharacterAssociationSeedProfile): KnownCharacterProfile {
  const portrait = "avatar" in profile ? profile.avatar : profile.coverImage;
  return {
    id: profile.id,
    name: profile.name,
    summary: profile.summary ?? "",
    useCases: "useCases" in profile ? profile.useCases : [],
    archivedAt: profile.archivedAt ?? null,
    deletedAt: profile.deletedAt ?? null,
    portrait: portrait ?? null,
  };
}

const roleLabels = {
  primary: "主要角色",
  supporting: "辅助角色",
  reference: "参考角色",
} as const;

export function CharacterAssociationPicker({
  value,
  onChange,
  initialProfiles = [],
  max = 8,
}: {
  value: CharacterAssociationValue;
  onChange: (next: CharacterAssociationValue) => void;
  initialProfiles?: CharacterAssociationSeedProfile[];
  max?: number;
}) {
  const detailRequests = useRef(new Set<string>());
  const [profiles, setProfiles] = useState<KnownCharacterProfile[]>(() => initialProfiles.map(normalizeProfile));
  const profilesRef = useRef(profiles);
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: "100", view: "all" });
    if (debounced) params.set("q", debounced);
    void fetch(`/api/v1/ai-models?${params}`, { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (response.status === 401) { setState("ready"); return; }
      if (!response.ok) { setState("error"); return; }
      const next = ((await response.json()).data as CharacterProfile[]).map(normalizeProfile);
      setProfiles((current) => {
        const merged = new Map(current.map((profile) => [profile.id, profile]));
        next.forEach((profile) => merged.set(profile.id, profile));
        return [...merged.values()];
      });
      setResultIds(next.map((profile) => profile.id));
      setState("ready");
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [debounced]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    const knownIds = new Set(profilesRef.current.map((profile) => profile.id));
    const missingIds = value
      .map((association) => association.id)
      .filter((id) => !knownIds.has(id) && !detailRequests.current.has(id));
    if (!missingIds.length) return;

    let active = true;
    missingIds.forEach((id) => detailRequests.current.add(id));
    void Promise.all(missingIds.map(async (id) => {
      try {
        const response = await fetch(`/api/v1/ai-models/${id}?includeDeleted=true`, { cache: "no-store" });
        if (!response.ok) return { id, profile: null };
        return { id, profile: normalizeProfile(((await response.json()).data) as CharacterProfile) };
      } catch {
        return { id, profile: null };
      }
    })).then((loaded) => {
      if (!active) return;
      loaded.filter((item) => !item.profile).forEach((item) => detailRequests.current.delete(item.id));
      const available = loaded.flatMap((item) => item.profile ? [item.profile] : []);
      if (!available.length) return;
      setProfiles((current) => {
        const merged = new Map(current.map((profile) => [profile.id, profile]));
        available.forEach((profile) => merged.set(profile.id, profile));
        return [...merged.values()];
      });
    });
    return () => { active = false; };
  }, [detailRetry, value]);

  const byId = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const selected = value.map((association) => ({ association, profile: byId.get(association.id) }));
  const candidates = profiles.filter((profile) => resultIds.includes(profile.id) && !profile.deletedAt && !profile.archivedAt && !value.some((item) => item.id === profile.id));

  function select(profile: KnownCharacterProfile) {
    if (value.length >= max) return;
    const role = value.some((item) => item.role === "primary") ? "supporting" : "primary";
    onChange([...value, { id: profile.id, role, sortOrder: value.length }]);
    setQuery("");
    setOpen(false);
  }

  function remove(id: string) {
    const next = value.filter((item) => item.id !== id).map((item, index) => ({ ...item, sortOrder: index }));
    if (next.length && !next.some((item) => item.role === "primary")) next[0] = { ...next[0], role: "primary" };
    onChange(next);
  }

  function setRole(id: string, role: CharacterAssociationValue[number]["role"]) {
    onChange(value.map((item) => {
      if (item.id === id) return { ...item, role };
      if (role === "primary" && item.role === "primary") return { ...item, role: "supporting" };
      return item;
    }));
  }

  return (
    <section className="character-association" aria-labelledby="character-association-title">
      <header className="character-section-heading"><div><span className="section-kicker">AI MODEL</span><h3 id="character-association-title">关联 AI Model</h3><p>把提示词与角色资产绑定；角色 Profile 会自动收录这条笔记。</p></div><strong>{value.length} / {max}</strong></header>
      {selected.length ? <div className="character-association__selected">{selected.map(({ association, profile }) => profile ? <article key={association.id}>
        <Link href={`/ai-models/${profile.id}`}>{profile.portrait ? <img src={profile.portrait.thumbnailUrl} alt={`${profile.name} 头像`} style={{ objectPosition: `${profile.portrait.focusX}% ${profile.portrait.focusY}%` }} /> : <span className="character-mini-placeholder">M</span>}</Link>
        <div><strong>{profile.name}</strong><small>{profile.deletedAt ? "在回收站 · 恢复或移除后再保存" : profile.archivedAt ? "已归档 · 历史关系仍保留" : profile.summary || "AI Model"}</small></div>
        <label><span className="sr-only">{profile.name} 的角色关系</span><select value={association.role} onChange={(event) => setRole(profile.id, event.target.value as CharacterAssociationValue[number]["role"])}>{Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <button type="button" onClick={() => remove(profile.id)} aria-label={`移除 AI Model ${profile.name}`}>移除</button>
      </article> : <article key={association.id}>
        <span className="character-mini-placeholder">?</span>
        <div><strong>正在读取 AI Model</strong><small>若角色已被永久删除，可移除此关联后保存。</small></div>
        <label><span className="sr-only">未读取角色的关系</span><select value={association.role} onChange={(event) => setRole(association.id, event.target.value as CharacterAssociationValue[number]["role"])}>{Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <button type="button" onClick={() => { detailRequests.current.delete(association.id); setDetailRetry((current) => current + 1); }} aria-label={`重新读取 AI Model ${association.id}`}>重试</button>
        <button type="button" onClick={() => remove(association.id)} aria-label={`移除未读取的 AI Model ${association.id}`}>移除</button>
      </article>)}</div> : <p className="character-association__empty">尚未关联角色；这条提示词仍可正常保存。</p>}

      <button className="character-association__add" disabled={value.length >= max} type="button" onClick={() => setOpen((current) => !current)}>{open ? "收起角色选择" : value.length >= max ? `已达到 ${max} 个角色上限` : "＋ 选择 AI Model"}</button>
      {open ? <div className="character-association__browser">
        <label><span className="sr-only">搜索可关联的 AI Model</span><input autoFocus aria-label="搜索可关联的 AI Model" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色名称或设定…" /></label>
        {state === "loading" ? <p role="status">正在读取角色资产…</p> : state === "error" ? <p role="alert">角色资产暂时无法读取，请稍后重试。</p> : candidates.length ? <div>{candidates.map((profile) => <button key={profile.id} type="button" onClick={() => select(profile)}>{profile.portrait ? <img src={profile.portrait.thumbnailUrl} alt="" style={{ objectPosition: `${profile.portrait.focusX}% ${profile.portrait.focusY}%` }} /> : <span className="character-mini-placeholder">M</span>}<span><strong>{profile.name}</strong><small>{profile.summary || profile.useCases.join(" · ") || "AI Model"}</small></span><b>选择</b></button>)}</div> : <p>没有找到可关联的 AI Model。<Link href="/ai-models/new">新建角色卡</Link></p>}
      </div> : null}
    </section>
  );
}
