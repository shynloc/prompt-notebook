"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Project { id: string; name: string; description: string; noteCount: number; smartFilter: Record<string, unknown> | null }

export function ProjectManager() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch("/api/v1/projects"); if (response.ok) setProjects((await response.json()).data); }
  useEffect(() => { let active = true; void fetch("/api/v1/projects").then(async (response) => { if (active && response.ok) setProjects((await response.json()).data); }); return () => { active = false; }; }, []);
  async function create(event: FormEvent) { event.preventDefault(); const response = await fetch("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description }) }); if (!response.ok) { setMessage((await response.json()).error?.message ?? "创建失败"); return; } setName(""); setDescription(""); setMessage("项目已创建"); await load(); }
  return <div className="productivity-layout"><form className="device-manager compact-form" onSubmit={create}><h3>新建项目</h3><label>名称<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><label>说明<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="primary-action" type="submit">创建项目</button>{message ? <p role="status">{message}</p> : null}</form><div className="tag-grid">{projects.map((project) => <article key={project.id}><div className="productivity-card"><strong>{project.name}</strong><p>{project.description || "未添加说明"}</p><span>{project.noteCount} 条提示词{project.smartFilter ? " · 智能集合" : ""}</span></div></article>)}</div></div>;
}
