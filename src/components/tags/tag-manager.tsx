"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Tag { id: string; name: string; count: number }

export function TagManager() {
  const [tags, setTags] = useState<Tag[]>([]);
  const load = useCallback(async () => { const response = await fetch("/api/v1/tags", { cache: "no-store" }); if (response.ok) setTags((await response.json()).data); }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) });
    if (response.ok) { event.currentTarget.reset(); await load(); }
  }
  async function rename(tag: Tag) {
    const name = window.prompt("新的标签名称", tag.name)?.trim(); if (!name || name === tag.name) return;
    const response = await fetch(`/api/v1/tags/${tag.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    if (response.ok) await load(); else window.alert("重命名失败，名称可能已存在。");
  }
  async function remove(tag: Tag) {
    if (!window.confirm(`删除标签“${tag.name}”？提示词本身不会被删除。`)) return;
    const response = await fetch(`/api/v1/tags/${tag.id}`, { method: "DELETE" }); if (response.ok) setTags((items) => items.filter((item) => item.id !== tag.id));
  }

  return <section className="tag-manager">
    <form onSubmit={create}><input name="name" required maxLength={40} placeholder="新标签名称" aria-label="新标签名称" /><button type="submit">新增标签</button></form>
    <div className="tag-grid">{tags.map((tag) => <article key={tag.id}><Link href={`/tags/${tag.id}`}><strong>{tag.name}</strong><span>{tag.count} 条提示词</span></Link><footer><button type="button" onClick={() => rename(tag)}>重命名</button><button className="danger-action" type="button" onClick={() => remove(tag)}>删除</button></footer></article>)}</div>
    {!tags.length ? <div className="gallery-state">还没有标签。在新建 Prompt 时输入标签，它会自动出现在这里。</div> : null}
  </section>;
}
