"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { CHARACTER_VIEW_OPTIONS, type CharacterProfile } from "./types";
import { AppDialog } from "@/components/ai/app-dialog";

function viewLabel(value: string) {
  return CHARACTER_VIEW_OPTIONS.find((option) => option.id === value)?.label ?? "其他";
}

export function GenerationCharacterPicker({
  selectedProfileId,
  selectedImageIds,
  maxImages,
  onChange,
}: {
  selectedProfileId?: string;
  selectedImageIds: string[];
  maxImages: number;
  onChange: (profileId: string | undefined, imageIds: string[]) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [draftProfileId, setDraftProfileId] = useState<string | undefined>(selectedProfileId);
  const [draftImageIds, setDraftImageIds] = useState(selectedImageIds);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    const params = new URLSearchParams({ limit: "100", view: "active" });
    void fetch(`/api/v1/ai-models?${params}`, { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (response.status === 401) { window.location.assign("/sign-in?returnTo=/imagehub"); return; }
      if (!response.ok) { setState("error"); return; }
      setProfiles((await response.json()).data);
      setState("ready");
      window.setTimeout(() => closeRef.current?.focus(), 0);
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [maxImages, open, selectedImageIds, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId || profiles.some((profile) => profile.id === selectedProfileId)) return;
    let active = true;
    void fetch(`/api/v1/ai-models/${selectedProfileId}`, { cache: "no-store" }).then(async (response) => {
      if (!active || !response.ok) return;
      const profile = (await response.json()).data as CharacterProfile;
      setProfiles((current) => current.some((item) => item.id === profile.id) ? current : [profile, ...current]);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [profiles, selectedProfileId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return profiles;
    return profiles.filter((profile) => [profile.name, profile.summary, profile.roleDefinition, ...profile.useCases].some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [profiles, query]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);

  function toggle(profile: CharacterProfile, imageId: string) {
    if (maxImages < 1) {
      setMessage("当前任务的 4 个参考图位置已被上传图片占满。");
      return;
    }
    if (draftProfileId !== profile.id) {
      setDraftProfileId(profile.id);
      setDraftImageIds([imageId]);
      setMessage(draftProfileId ? `已切换到 ${profile.name}，上一位 AI Model 的参考图已清除。` : `已选择 ${profile.name}。`);
      return;
    }
    if (draftImageIds.includes(imageId)) {
      const next = draftImageIds.filter((id) => id !== imageId);
      setDraftImageIds(next);
      if (!next.length) setDraftProfileId(undefined);
      return;
    }
    if (draftImageIds.length >= maxImages) {
      setMessage(`当前最多还可选择 ${maxImages} 张 AI Model 参考图。`);
      return;
    }
    setDraftImageIds([...draftImageIds, imageId]);
  }

  function choosePrimary(profile: CharacterProfile) {
    const image = profile.primaryImage ?? profile.images[0];
    if (!image) {
      setMessage(`${profile.name} 还没有可用的角色图片。`);
      return;
    }
    setDraftProfileId(profile.id);
    setDraftImageIds([image.id]);
    setMessage(`已选择 ${profile.name} 的默认主图。`);
  }

  function apply() {
    onChange(draftImageIds.length ? draftProfileId : undefined, draftImageIds.slice(0, maxImages));
    closePicker();
  }

  function openPicker() {
    setDraftProfileId(selectedProfileId);
    setDraftImageIds(selectedImageIds.slice(0, maxImages));
    setState("loading");
    setMessage("");
    setOpen(true);
    window.requestAnimationFrame(() => closeRef.current?.focus());
  }

  function closePicker() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="generation-character-picker">
      <button ref={triggerRef} className="generation-character-picker__trigger" disabled={maxImages < 1} type="button" onClick={openPicker}>
        <span>{selectedProfile?.coverImage ? <img src={selectedProfile.coverImage.thumbnailUrl} alt="" /> : <b aria-hidden="true">M</b>}</span>
        <span><strong>{selectedProfile ? selectedProfile.name : "从 AI Model 选择"}</strong><small>{selectedImageIds.length ? `已选 ${selectedImageIds.length} 张角色参考图` : maxImages < 1 ? "参考图位置已满" : "使用角色主图或备用图"}</small></span>
      </button>
      {selectedImageIds.length ? <button className="generation-character-picker__clear" type="button" onClick={() => onChange(undefined, [])}>清除 AI Model</button> : null}

      {open ? <AppDialog className="character-reference-dialog" labelledBy="character-reference-title" onClose={closePicker}>
        <div ref={panelRef} className="character-reference-dialog__panel">
          <header><div><span className="section-kicker">AI MODEL CASTING</span><h3 id="character-reference-title">选择垫图模特</h3><p>一次任务只使用一个 AI Model，可从该角色选择多张参考图。</p></div><button ref={closeRef} type="button" onClick={closePicker} aria-label="关闭 AI Model 选择器">×</button></header>
          <div className="character-reference-toolbar"><label><span className="sr-only">搜索生图 AI Model</span><input aria-label="搜索生图 AI Model" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色名称、用途或设定…" /></label><span>已选择 {draftImageIds.length} / {maxImages}</span></div>
          <div className="character-reference-feedback">{message ? <p className="character-feedback" role="status">{message}</p> : null}</div>
          <div className="character-reference-table-wrap">
            {state === "loading" ? <div className="character-library-state" role="status">正在读取角色档案…</div> : null}
            {state === "error" ? <div className="character-library-state"><strong>角色资产读取失败</strong><p>关闭后重试，当前生图内容不会丢失。</p></div> : null}
            {state === "ready" && !filtered.length ? <div className="character-library-state"><strong>没有可用的 AI Model</strong><p>可以先创建角色卡并上传参考图片。</p><Link href="/ai-models/new">新建 AI Model</Link></div> : null}
            {state === "ready" && filtered.length ? <table className="character-reference-table"><thead><tr><th>AI MODEL AVATAR</th><th>Name</th><th>Reference Photos</th><th>Quick Action</th></tr></thead><tbody>{filtered.map((profile) => <tr data-selected={draftProfileId === profile.id} key={profile.id}>
              <td data-label="AI MODEL AVATAR"><Link href={`/ai-models/${profile.id}`} target="_blank" aria-label={`在新窗口查看 ${profile.name} Profile`}>{profile.coverImage ? <img src={profile.coverImage.thumbnailUrl} alt={`${profile.name} 角色封面`} style={{ objectPosition: `${profile.coverImage.focusX}% ${profile.coverImage.focusY}%` }} /> : <span className="character-mini-placeholder">M</span>}</Link></td>
              <th data-label="Name" scope="row"><strong>{profile.name}</strong><small>{profile.summary || profile.useCases.join(" · ") || "AI Model"}</small><Link href={`/ai-models/${profile.id}`} target="_blank">预览角色卡 ↗</Link></th>
              <td data-label="Reference Photos"><div className="character-reference-photos">{profile.images.map((image, index) => { const selected = draftProfileId === profile.id && draftImageIds.includes(image.id); return <button aria-label={`选择 ${profile.name} ${image.isPrimary ? "主图" : `参考图 ${index + 1}`}`} aria-pressed={selected} key={image.id} type="button" onClick={() => toggle(profile, image.id)}><img src={image.thumbnailUrl} alt="" loading="lazy" /><span>{selected ? draftImageIds.indexOf(image.id) + 1 : image.isPrimary ? "主图" : viewLabel(image.viewType)}</span></button>; })}</div></td>
              <td data-label="Quick Action"><button disabled={!profile.images.length || maxImages < 1} type="button" onClick={() => choosePrimary(profile)}>使用主图</button></td>
            </tr>)}</tbody></table> : null}
          </div>
          <footer className="character-reference-tray"><div><strong>{draftProfileId ? profiles.find((profile) => profile.id === draftProfileId)?.name : "尚未选择角色"}</strong><span>{draftImageIds.length ? `${draftImageIds.length} 张参考图会随任务安全快照` : "点击照片即可选择"}</span></div><button type="button" onClick={() => { setDraftProfileId(undefined); setDraftImageIds([]); setMessage(""); }}>清空</button><button className="primary-action" type="button" onClick={apply}>确认使用</button></footer>
        </div>
      </AppDialog> : null}
    </div>
  );
}
