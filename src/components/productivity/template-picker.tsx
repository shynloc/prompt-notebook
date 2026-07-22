"use client";

import { useEffect, useState } from "react";

interface Template { id: string; name: string; content: string }

export function TemplatePicker({ onApply }: { onApply: (content: string) => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState("");
  useEffect(() => { let active = true; void fetch("/api/v1/templates").then(async (response) => { if (active && response.ok) setTemplates((await response.json()).data); }); return () => { active = false; }; }, []);
  if (!templates.length) return null;
  return <div className="template-picker"><label>从模板开始<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择模板…</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><button disabled={!selected} type="button" onClick={() => { const template = templates.find((item) => item.id === selected); if (template) onApply(template.content); }}>应用模板</button></div>;
}
