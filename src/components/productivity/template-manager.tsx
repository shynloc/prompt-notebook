"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Template { id: string; name: string; content: string; variables: string[] }

export function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch("/api/v1/templates"); if (response.ok) setTemplates((await response.json()).data); }
  useEffect(() => { let active = true; void fetch("/api/v1/templates").then(async (response) => { if (active && response.ok) setTemplates((await response.json()).data); }); return () => { active = false; }; }, []);
  async function create(event: FormEvent) { event.preventDefault(); const response = await fetch("/api/v1/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, content }) }); if (!response.ok) { setMessage((await response.json()).error?.message ?? "创建失败"); return; } setName(""); setContent(""); setMessage("模板已创建"); await load(); }
  return <div className="productivity-layout"><form className="device-manager compact-form" onSubmit={create}><h3>新建变量模板</h3><label>名称<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><label>模板内容<textarea required maxLength={100000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="为 {{subject}} 创建一幅 {{style}} 风格的图像" /></label><small>使用 {"{{变量名}}"} 定义可替换变量，最多 20 个。</small><button className="primary-action" type="submit">保存模板</button>{message ? <p role="status">{message}</p> : null}</form><div className="tag-grid">{templates.map((template) => <article key={template.id}><div className="productivity-card"><strong>{template.name}</strong><p>{template.content.slice(0, 160)}</p><span>{template.variables.length ? `变量：${template.variables.join("、")}` : "无变量"}</span></div></article>)}</div></div>;
}
