"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, type ChangeEvent, type KeyboardEvent } from "react";

import type { NoteImage } from "@/components/notes/types";
import {
  CHARACTER_VIEW_OPTIONS,
  characterApiMessage,
  mediaToCharacterImage,
  type CharacterImageDraft,
} from "./types";

const MAX_IMAGES = 12;

function identity(image: CharacterImageDraft) {
  return image.id ?? `${image.storageProvider}:${image.objectKey}`;
}

function addDefaults(images: CharacterImageDraft[], image: CharacterImageDraft) {
  const first = images.length === 0;
  return [...images, { ...image, isCover: first, isPrimary: first }];
}

export function CharacterImageManager({
  images,
  onChange,
}: {
  images: CharacterImageDraft[];
  onChange: (images: CharacterImageDraft[]) => void;
}) {
  const [mode, setMode] = useState<"upload" | "link" | "library">("upload");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [library, setLibrary] = useState<CharacterImageDraft[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, MAX_IMAGES - images.length));
    event.target.value = "";
    if (!files.length || busy) return;
    setBusy(true);
    setMessage(`正在上传 ${files.length} 张角色图片…`);
    const next = [...images];
    let failed = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/v1/uploads", { method: "POST", body: form });
        const body = await response.json().catch(() => null);
        if (response.status === 401) {
          window.location.assign("/sign-in?returnTo=/ai-models/new");
          return;
        }
        const image = response.ok ? mediaToCharacterImage(body.data as NoteImage) : null;
        if (!image || next.some((current) => identity(current) === identity(image))) {
          failed += 1;
          continue;
        }
        next.push({ ...image, isCover: next.length === 0, isPrimary: next.length === 0 });
      }
      if (next.length !== images.length) onChange(next);
      const uploaded = next.length - images.length;
      setMessage(failed ? `已添加 ${uploaded} 张，${failed} 张未能导入。` : `已添加 ${uploaded} 张角色图片。`);
    } catch {
      setMessage("图片上传中断，已经成功的图片仍会保留，请检查网络后重试。");
      if (next.length !== images.length) onChange(next);
    } finally {
      setBusy(false);
    }
  }

  async function importLink() {
    const url = linkUrl.trim();
    if (!url || busy || images.length >= MAX_IMAGES) return;
    setBusy(true);
    setMessage("正在解析并转存角色图片…");
    try {
      const response = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 401) {
        window.location.assign("/sign-in?returnTo=/ai-models/new");
        return;
      }
      if (!response.ok) {
        setMessage(characterApiMessage(body, "图片导入失败。"));
        return;
      }
      const image = mediaToCharacterImage(body.data as NoteImage);
      if (!image) {
        setMessage("AI Model 只支持 JPEG、PNG 和 WebP 图片。");
        return;
      }
      if (images.some((current) => identity(current) === identity(image))) {
        setMessage("这张图片已经在角色档案中。 ");
        return;
      }
      onChange(addDefaults(images, image));
      setLinkUrl("");
      setMessage("图片已解析、转存并加入角色档案。");
    } catch {
      setMessage("无法连接图片服务，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function loadLibrary() {
    setMode("library");
    if (libraryLoaded || busy) return;
    setBusy(true);
    setMessage("正在读取图床图片…");
    try {
      const response = await fetch("/api/v1/images", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "图床图片读取失败。"));
        return;
      }
      setLibrary((body.data as NoteImage[]).flatMap((image) => {
        const normalized = mediaToCharacterImage(image);
        return normalized ? [normalized] : [];
      }));
      setLibraryLoaded(true);
      setMessage("");
    } catch {
      setMessage("无法连接图床图片库，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  function chooseFromLibrary(image: CharacterImageDraft) {
    if (images.length >= MAX_IMAGES) {
      setMessage("每个 AI Model 最多保存 12 张图片。");
      return;
    }
    if (images.some((current) => identity(current) === identity(image))) {
      setMessage("这张图片已经在角色档案中。");
      return;
    }
    onChange(addDefaults(images, image));
    setMessage("图床图片已加入角色档案。");
  }

  function update(index: number, changes: Partial<CharacterImageDraft>) {
    onChange(images.map((image, itemIndex) => itemIndex === index ? { ...image, ...changes } : image));
  }

  function setExclusive(index: number, field: "isCover" | "isPrimary") {
    onChange(images.map((image, itemIndex) => ({ ...image, [field]: itemIndex === index })));
    setMessage(field === "isCover" ? "角色封面已更新。" : "默认主参考图已更新。");
  }

  function remove(index: number) {
    const removed = images[index];
    const next = images.filter((_, itemIndex) => itemIndex !== index);
    if (next.length && removed.isCover && !next.some((image) => image.isCover)) next[0] = { ...next[0], isCover: true };
    if (next.length && removed.isPrimary && !next.some((image) => image.isPrimary)) next[0] = { ...next[0], isPrimary: true };
    onChange(next);
    setMessage(next.length ? "图片已移除；如有需要，封面和主图已自动顺延。" : "角色图片已全部移除。");
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setMessage(`图片已移动到第 ${target + 1} 位。`);
  }

  function linkKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void importLink();
  }

  return (
    <section className="character-images" aria-labelledby="character-images-title">
      <header className="character-section-heading">
        <div><span className="section-kicker">REFERENCE ASSETS</span><h3 id="character-images-title">角色图片资产</h3><p>设置角色封面、默认主图与不同视角的备用参考图。</p></div>
        <strong>{images.length} / {MAX_IMAGES}</strong>
      </header>

      {images.length ? <ol className="character-image-grid">
        {images.map((image, index) => (
          <li className="character-image-card" key={identity(image)}>
            <div className="character-image-card__preview">
              <img src={image.thumbnailUrl} alt={`${image.caption || "角色参考图"} ${index + 1}`} loading="lazy" style={{ objectPosition: `${image.focusX}% ${image.focusY}%` }} />
              <span className="character-image-card__number">{String(index + 1).padStart(2, "0")}</span>
              <div className="character-image-card__badges">
                {image.isCover ? <span>封面</span> : null}
                {image.isPrimary ? <span>主图</span> : null}
              </div>
            </div>
            <div className="character-image-card__form">
              <label>视角<select aria-label={`图片 ${index + 1} 视角`} value={image.viewType} onChange={(event) => update(index, { viewType: event.target.value as CharacterImageDraft["viewType"] })}>{CHARACTER_VIEW_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label>说明<input aria-label={`图片 ${index + 1} 说明`} maxLength={300} value={image.caption} onChange={(event) => update(index, { caption: event.target.value })} placeholder="例如：自然光正脸" /></label>
              {image.isCover ? <details><summary>封面取景焦点</summary><div className="character-focus-grid"><label>水平 {image.focusX}%<input aria-label="封面水平焦点" type="range" min="0" max="100" value={image.focusX} onChange={(event) => update(index, { focusX: Number(event.target.value) })} /></label><label>垂直 {image.focusY}%<input aria-label="封面垂直焦点" type="range" min="0" max="100" value={image.focusY} onChange={(event) => update(index, { focusY: Number(event.target.value) })} /></label></div></details> : null}
            </div>
            <footer className="character-image-card__actions">
              <button disabled={index === 0} type="button" onClick={() => move(index, -1)} aria-label={`将图片 ${index + 1} 前移`}>← 前移</button>
              <button disabled={index === images.length - 1} type="button" onClick={() => move(index, 1)} aria-label={`将图片 ${index + 1} 后移`}>后移 →</button>
              <button aria-pressed={image.isCover} type="button" onClick={() => setExclusive(index, "isCover")}>{image.isCover ? "当前封面" : "设为封面"}</button>
              <button aria-pressed={image.isPrimary} type="button" onClick={() => setExclusive(index, "isPrimary")}>{image.isPrimary ? "当前主图" : "设为主图"}</button>
              <button className="danger-action" type="button" onClick={() => remove(index)}>移除</button>
            </footer>
          </li>
        ))}
      </ol> : <div className="character-image-empty"><span aria-hidden="true">M</span><strong>还没有角色图片</strong><p>可以先保存纯文字角色卡，之后再补充主图和备用参考图。</p></div>}

      <div className="character-image-modes" role="tablist" aria-label="添加角色图片方式">
        <button aria-selected={mode === "upload"} role="tab" type="button" onClick={() => setMode("upload")}>上传图片</button>
        <button aria-selected={mode === "link"} role="tab" type="button" onClick={() => setMode("link")}>粘贴链接</button>
        <button aria-selected={mode === "library"} role="tab" type="button" onClick={() => void loadLibrary()}>图床图片</button>
      </div>

      {mode === "upload" ? <label className="character-upload-drop"><input accept="image/jpeg,image/png,image/webp" disabled={busy || images.length >= MAX_IMAGES} multiple type="file" onChange={(event) => void uploadFiles(event)} /><strong>{busy ? "正在上传…" : "点击选择一张或多张图片"}</strong><span>JPEG / PNG / WebP，单张最大 10MB</span></label> : null}
      {mode === "link" ? <div className="character-link-import"><input aria-label="角色图片或网页链接" disabled={busy || images.length >= MAX_IMAGES} type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={linkKeyDown} placeholder="图片直链或包含预览图的网页地址" /><button disabled={busy || !linkUrl.trim() || images.length >= MAX_IMAGES} type="button" onClick={() => void importLink()}>{busy ? "解析中…" : "解析并导入"}</button></div> : null}
      {mode === "library" ? <div className="character-media-library" aria-busy={busy}>{library.length ? library.map((image) => <button aria-label="选择图床图片" disabled={images.length >= MAX_IMAGES} key={identity(image)} type="button" onClick={() => chooseFromLibrary(image)}><img alt="图床中的角色候选图片" loading="lazy" src={image.thumbnailUrl} /></button>) : !busy ? <p>图床图库暂时没有可用的 JPEG、PNG 或 WebP 图片。</p> : null}</div> : null}
      {message ? <p className="character-feedback" role="status" aria-live="polite">{message}</p> : null}
    </section>
  );
}
