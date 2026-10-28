"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState, type KeyboardEvent } from "react";

import type { NoteImage } from "@/components/notes/types";

export function ImagePicker({ images, onChange }: { images: NoteImage[]; onChange: (images: NoteImage[]) => void }) {
  const [mode, setMode] = useState<"upload" | "link" | "library">("upload");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [library, setLibrary] = useState<NoteImage[]>([]);

  async function upload(file: File) {
    if (pending.current || images.length >= 8) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    setMessage("正在上传到当前图片存储…");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/v1/uploads", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) { setError(true); setMessage(body.error?.message ?? "图片上传失败，请检查图片存储设置后重试。"); return; }
      onChange([...images, body.data]);
      setMessage(body.data.storageProvider === "local" ? "图片已上传到站点本地存储并设为预览图" : "图片已上传并设为预览图");
    } catch {
      setError(true);
      setMessage("网络连接失败，图片没有上传，请重试");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function importLink() {
    const url = linkUrl.trim();
    if (!url || pending.current || images.length >= 8) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    setMessage("正在解析网页并安全转存图片…");
    try {
      const response = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json();
      if (!response.ok) { setError(true); setMessage(body.error?.message ?? "图片导入失败，请检查图片存储设置后重试。"); return; }
      onChange([...images, body.data]);
      setLinkUrl("");
      setMessage("已从链接解析图片并保存到当前图片存储");
    } catch {
      setError(true);
      setMessage("网络连接失败，图片没有导入，请重试");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function linkKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    void importLink();
  }

  async function loadLibrary() {
    if (pending.current) return;
    pending.current = true;
    setMode("library");
    setBusy(true); setError(false); setMessage("正在读取图片库…");
    try {
      const response = await fetch("/api/v1/images", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) { setError(true); setMessage(body.error?.message ?? "图片库加载失败，请重试。"); return; }
      setLibrary(body.data); setMessage("");
    } catch { setError(true); setMessage("图片库暂时无法加载，请检查网络后重试。"); }
    finally { pending.current = false; setBusy(false); }
  }

  function choose(item: NoteImage) {
    if (pending.current || images.length >= 8 || images.some((image) => image.displayUrl === item.displayUrl)) return;
    onChange([...images, item]);
  }

  return (
    <section className="image-picker">
      <div className="image-picker__header"><div><span className="section-kicker">ARTWORK</span><h3>图片预览</h3></div><span>{images.length}/8</span></div>
      {images.length ? <div className="selected-images">
        {images.map((image, index) => <div key={`${image.displayUrl}-${index}`} className="selected-image">
          <img src={image.thumbnailUrl} alt={`预览图 ${index + 1}`} />
          {index === 0 ? <span>封面</span> : <button disabled={busy} type="button" onClick={() => onChange([image, ...images.filter((_, itemIndex) => itemIndex !== index)])}>设为封面</button>}
          <button disabled={busy} className="selected-image__remove" type="button" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除图片">×</button>
        </div>)}
      </div> : <div className="image-placeholder"><span>✦</span><p>添加生成作品作为提示词封面</p></div>}
      <div className="image-modes" role="tablist" aria-label="添加图片方式">
        <button disabled={busy} aria-selected={mode === "upload"} role="tab" type="button" onClick={() => setMode("upload")}>上传图片</button>
        <button disabled={busy} aria-selected={mode === "link"} role="tab" type="button" onClick={() => setMode("link")}>粘贴链接</button>
        <button disabled={busy} aria-selected={mode === "library"} role="tab" type="button" onClick={() => void loadLibrary()}>图片库</button>
      </div>
      {mode === "upload" ? <label className="upload-drop"><input aria-label="上传预览图片" disabled={busy || images.length >= 8} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><strong>{busy ? "图片处理中…" : "点击选择图片"}</strong><span>JPEG / PNG / WebP，最大 10MB</span></label> : null}
      {mode === "link" ? <div className="link-import">
        <input value={linkUrl} type="url" placeholder="图片直链、X 帖子或包含预览图的网页" aria-label="图片或网页链接" onChange={(event) => { event.stopPropagation(); setLinkUrl(event.target.value); }} onKeyDown={linkKeyDown} />
        <button disabled={busy || !linkUrl.trim() || images.length >= 8} type="button" onClick={() => void importLink()}>{busy ? "正在解析…" : "解析并导入"}</button>
        <small>支持图片直链，以及提供 Open Graph 或 Twitter Card 预览图的网页。</small>
      </div> : null}
      {mode === "library" ? <div className="image-library" aria-busy={busy}>{library.map((image) => <button disabled={busy || images.length >= 8} key={image.displayUrl} type="button" onClick={() => choose(image)}><img src={image.thumbnailUrl} alt="图片库图片" loading="lazy" /></button>)}{!busy && !library.length ? <p>保存过图片后，它们会出现在这里。</p> : null}</div> : null}
      {message ? <p className={`upload-message${error ? " upload-message--error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{message}</p> : null}
    </section>
  );
}
