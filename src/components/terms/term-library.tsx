"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

interface Term { id: string; category: string; label: string; value: string; builtIn: boolean }

export function TermLibrary({ onInsert }: { onInsert?: (value: string) => void }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [showForm, setShowForm] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    const response = await fetch("/api/v1/terms", { cache: "no-store" });
    if (!response.ok) { setState("error"); return; }
    const body = await response.json();
    setTerms([...body.data.builtIn, ...body.data.custom]);
    setState("ready");
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const categories = useMemo(() => ["全部", ...Array.from(new Set(terms.map((term) => term.category)))], [terms]);
  const visible = useMemo(() => terms.filter((term) => {
    const matchesCategory = category === "全部" || term.category === category;
    const haystack = `${term.label} ${term.value}`.toLocaleLowerCase();
    return matchesCategory && haystack.includes(query.toLocaleLowerCase());
  }), [category, query, terms]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/terms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: form.get("category"), label: form.get("label"), value: form.get("value") }) });
    if (response.ok) { event.currentTarget.reset(); setShowForm(false); await load(); }
  }

  async function remove(id: string) {
    if (!window.confirm("删除这个自定义词条？")) return;
    const response = await fetch(`/api/v1/terms/${id}`, { method: "DELETE" });
    if (response.ok) setTerms((items) => items.filter((term) => term.id !== id));
  }

  async function edit(term: Term) {
    const label = window.prompt("词条名称", term.label)?.trim();
    if (!label) return;
    const value = window.prompt("插入内容", term.value)?.trim();
    if (!value) return;
    const category = window.prompt("分类", term.category)?.trim();
    if (!category) return;
    const response = await fetch(`/api/v1/terms/${term.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, value, category }) });
    if (response.ok) await load();
  }

  return (
    <section className="term-library" aria-label="提示词百科词库">
      <header><div><span className="section-kicker">PROMPT WIKI</span><h3>提示词百科</h3></div><button type="button" onClick={() => setShowForm((value) => !value)}>＋自定义</button></header>
      {showForm ? <form className="term-form" onSubmit={create}>
        <input name="category" required maxLength={60} placeholder="分类，例如：光线" aria-label="词条分类" />
        <input name="label" required maxLength={100} placeholder="中文名称" aria-label="词条名称" />
        <input name="value" required maxLength={500} placeholder="插入内容，例如：soft light" aria-label="词条内容" />
        <button type="submit">保存词条</button>
      </form> : null}
      <input className="term-search" value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="搜索中文说明或英文词汇…" aria-label="搜索词库" />
      <div className="category-tabs" role="tablist" aria-label="词库分类">
        {categories.map((item) => <button aria-selected={category === item} role="tab" type="button" key={item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="term-list">
        {state === "loading" ? <p className="empty-copy" role="status">正在加载词库…</p> : null}
        {state === "error" ? <p className="empty-copy" role="alert">词库加载失败。<button type="button" onClick={() => void load()}>重试</button></p> : null}
        {visible.map((term) => <div className="term-chip" key={term.id}>
          <button type="button" onClick={() => onInsert?.(term.value)} title={`插入 ${term.value}`}><strong>{term.label}</strong><span>{term.value}</span></button>
          {!term.builtIn ? <><button className="term-chip__edit" type="button" onClick={() => edit(term)} aria-label={`编辑 ${term.label}`}>✎</button><button className="term-chip__delete" type="button" onClick={() => remove(term.id)} aria-label={`删除 ${term.label}`}>×</button></> : null}
        </div>)}
      </div>
      {state === "ready" && !visible.length ? <p className="empty-copy">没有匹配的词条。</p> : null}
    </section>
  );
}
