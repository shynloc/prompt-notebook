"use client";

import { useEffect, useState } from "react";

export interface AdvancedFilterValue { field: "all" | "title" | "prompt"; sourceHost: string; dateFrom: string; dateTo: string; projectId: string }
interface Project { id: string; name: string }

export function AdvancedFilters({ value, query, onChange }: { value: AdvancedFilterValue; query: string; onChange: (value: AdvancedFilterValue) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => { let active = true; void fetch("/api/v1/projects").then(async (response) => { if (active && response.ok) setProjects((await response.json()).data); }).catch(() => undefined); return () => { active = false; }; }, []);
  function set<K extends keyof AdvancedFilterValue>(key: K, next: AdvancedFilterValue[K]) { onChange({ ...value, [key]: next }); }
  async function saveSearch() { const name = window.prompt("为这个智能集合命名"); if (!name) return; const response = await fetch("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: "保存的搜索条件", smartFilter: { q: query, ...value } }) }); setMessage(response.ok ? "智能集合已保存到项目。" : "保存失败，请更换名称后重试。"); }
  async function checkDuplicates() { const response = await fetch("/api/v1/notes/duplicates"); if (!response.ok) { setMessage("重复检测失败"); return; } const data = (await response.json()).data; setMessage(data.groups.length ? `发现 ${data.groups.length} 组完全重复的提示词。` : "没有发现完全重复的提示词。"); }
  return <details className="advanced-filters"><summary>高级筛选与重复检测</summary><div className="advanced-filters__grid"><label>搜索范围<select value={value.field} onChange={(event) => set("field", event.target.value as AdvancedFilterValue["field"])}><option value="all">标题、内容和标签</option><option value="title">仅标题</option><option value="prompt">仅提示词内容</option></select></label><label>来源网站<input value={value.sourceHost} onChange={(event) => set("sourceHost", event.target.value.trim())} placeholder="example.com" /></label><label>开始日期<input type="date" value={value.dateFrom} onChange={(event) => set("dateFrom", event.target.value)} /></label><label>结束日期<input type="date" value={value.dateTo} onChange={(event) => set("dateTo", event.target.value)} /></label><label>项目<select value={value.projectId} onChange={(event) => set("projectId", event.target.value)}><option value="">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><div className="data-transfer__actions"><button type="button" onClick={() => onChange({ field: "all", sourceHost: "", dateFrom: "", dateTo: "", projectId: "" })}>重置高级筛选</button><button type="button" onClick={() => void saveSearch()}>保存为智能集合</button><button type="button" onClick={() => void checkDuplicates()}>检测重复提示词</button></div>{message ? <p role="status">{message}</p> : null}</details>;
}
