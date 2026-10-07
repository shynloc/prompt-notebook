"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { TERM_ANALYSIS_CATEGORIES } from "@/modules/terms/term-categories";

type Confidence = "high" | "medium" | "low";
interface Duplicate {
  kind: "exact" | "similar";
  id: string;
  label: string;
  value: string;
  builtIn: boolean;
}
interface Candidate {
  id: string;
  category: string;
  label: string;
  value: string;
  sourceExcerpt: string;
  confidence: Confidence;
  duplicate: Duplicate | null;
}
interface AnalysisResult {
  candidates: Candidate[];
  model: { id: string; name: string; inherited: boolean };
}

const stages = ["正在理解提示词内容…", "正在识别并分类描述片段…", "正在与现有百科检查重复…"];

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function errorDetails(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null || !("error" in body)) return { message: fallback, code: "" };
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return { message: fallback, code: "" };
  return {
    message: "message" in error && typeof error.message === "string" ? error.message : fallback,
    code: "code" in error && typeof error.code === "string" ? error.code : "",
  };
}

export function TermAnalysisWorkbench({ onSaved, initialPrompt = "", onPromptChange }: { onSaved: () => void; initialPrompt?: string; onPromptChange?: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [needsConfiguration, setNeedsConfiguration] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!analyzing) return;
    const timer = window.setInterval(() => setStage((value) => (value + 1) % stages.length), 1400);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  const groups = useMemo(() => {
    const values = new Map<string, Candidate[]>();
    for (const candidate of result?.candidates ?? []) {
      values.set(candidate.category, [...(values.get(candidate.category) ?? []), candidate]);
    }
    return [...values.entries()].sort(([left], [right]) => {
      const leftIndex = TERM_ANALYSIS_CATEGORIES.indexOf(left as (typeof TERM_ANALYSIS_CATEGORIES)[number]);
      const rightIndex = TERM_ANALYSIS_CATEGORIES.indexOf(right as (typeof TERM_ANALYSIS_CATEGORIES)[number]);
      return leftIndex - rightIndex;
    });
  }, [result]);

  function toggle(candidate: Candidate) {
    if (candidate.duplicate?.kind === "exact") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id);
      return next;
    });
  }

  function updateCandidate(id: string, changes: Partial<Pick<Candidate, "category" | "label" | "value">>) {
    setResult((current) => current ? {
      ...current,
      candidates: current.candidates.map((candidate) => candidate.id === id
        ? { ...candidate, ...changes, duplicate: null }
        : candidate),
    } : current);
  }

  async function analyze() {
    const value = prompt.trim();
    if (value.length < 10 || analyzing) return;
    setAnalyzing(true);
    setStage(0);
    setError("");
    setMessage("");
    setNeedsConfiguration(false);
    setSelected(new Set());
    setEditingId(null);
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/v1/terms/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value }),
        signal: controller.current.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        const details = errorDetails(body, "提示词分析失败，请稍后重试。");
        setNeedsConfiguration(details.code === "AI_TERM_ANALYZER_NOT_CONFIGURED");
        throw new Error(details.message);
      }
      setResult(body.data);
      setMessage(body.data.candidates.length
        ? `分析完成，找到 ${body.data.candidates.length} 个候选词条。请确认后再批量收录。`
        : "分析完成，但没有找到适合收录的独立词条。");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") setMessage("已取消本次分析，输入内容仍然保留。");
      else setError(caught instanceof Error ? caught.message : "提示词分析失败，请稍后重试。");
    } finally {
      controller.current = null;
      setAnalyzing(false);
    }
  }

  function cancel() {
    controller.current?.abort();
  }

  async function saveSelected() {
    if (!result || !selected.size || saving) return;
    const terms = result.candidates
      .filter((candidate) => selected.has(candidate.id))
      .map(({ category, label, value }) => ({ category, label: label.trim(), value: value.trim() }))
      .filter((term) => term.category && term.label && term.value);
    if (!terms.length) { setError("所选词条缺少名称、分类或插入内容。"); return; }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/terms/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorDetails(body, "批量收录失败。").message);
      const savedKeys = new Set([
        ...body.data.created.map((term: { category: string; label: string; value: string }) => `${normalized(term.category)}:${normalized(term.label)}:${normalized(term.value)}`),
        ...body.data.skipped.filter((item: { reason: string }) => item.reason === "duplicate")
          .map((item: { term: { category: string; label: string; value: string } }) => `${normalized(item.term.category)}:${normalized(item.term.label)}:${normalized(item.term.value)}`),
      ]);
      setResult((current) => current ? {
        ...current,
        candidates: current.candidates.map((candidate) => {
          const key = `${normalized(candidate.category)}:${normalized(candidate.label)}:${normalized(candidate.value)}`;
          return savedKeys.has(key) ? { ...candidate, duplicate: { kind: "exact", id: "saved", label: candidate.label, value: candidate.value, builtIn: false } } : candidate;
        }),
      } : current);
      setSelected((current) => new Set([...current].filter((id) => {
        const candidate = result.candidates.find((item) => item.id === id);
        if (!candidate) return false;
        const key = `${normalized(candidate.category)}:${normalized(candidate.label)}:${normalized(candidate.value)}`;
        return !savedKeys.has(key);
      })));
      if (body.data.created.length) onSaved();
      const limited = body.data.skipped.filter((item: { reason: string }) => item.reason === "limit").length;
      setMessage(`已收录 ${body.data.created.length} 个词条${body.data.skipped.length - limited ? `，跳过 ${body.data.skipped.length - limited} 个重复项` : ""}${limited ? `；${limited} 个因词库上限未保存` : ""}。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量收录失败。");
    } finally {
      setSaving(false);
    }
  }

  const eligible = result?.candidates.filter((candidate) => candidate.duplicate?.kind !== "exact") ?? [];
  return <section className="term-analysis" aria-labelledby="term-analysis-title">
    <div className="term-analysis__input">
      <div><span className="section-kicker">AI ANALYSIS</span><h3 id="term-analysis-title">从完整 Prompt 提炼词条</h3><p>AI 只负责提取和分类，最终由你选择、编辑并批量收录。</p></div>
      <label>完整提示词<textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); onPromptChange?.(event.target.value); }} maxLength={50_000} placeholder="粘贴一段包含人物、姿势、场景、灯光、镜头或风格描述的完整提示词…" /></label>
      <div className="term-analysis__input-footer"><span>{prompt.length.toLocaleString()} / 50,000</span>{analyzing ? <button type="button" onClick={cancel}>取消分析</button> : <button className="primary-action" type="button" disabled={prompt.trim().length < 10} onClick={() => void analyze()}>✦ AI 一键分析</button>}</div>
      {analyzing ? <div className="term-analysis__progress" role="status"><span className="button-spinner" aria-hidden="true" />{stages[stage]}</div> : null}
      {error ? <div className="term-analysis__notice term-analysis__notice--error" role="alert"><span>{error}</span>{needsConfiguration ? <a href="/settings/ai">前往设置模型</a> : <button type="button" onClick={() => void analyze()}>重新分析</button>}</div> : null}
      {message ? <p className="term-analysis__notice" role="status">{message}</p> : null}
    </div>

    {result ? <div className="term-analysis__results">
      <header><div><span className="section-kicker">CANDIDATES</span><h3>分析结果</h3><p>模型：{result.model.name}{result.model.inherited ? " · 继承提示词优化模型" : " · 词库分析模型"}</p></div><span>{result.candidates.length} 项</span></header>
      {!result.candidates.length ? <div className="gallery-state">没有识别到可独立复用的词条。可以补充更具体的场景、动作、灯光或摄影描述后重试。</div> : null}
      {groups.map(([category, candidates]) => <section className="term-candidate-group" key={category}><header><h4>{category}</h4><span>{candidates.length}</span></header><div className="term-candidate-cloud">{candidates.map((candidate) => {
        const exact = candidate.duplicate?.kind === "exact";
        const editing = editingId === candidate.id;
        return <article className={`term-candidate${selected.has(candidate.id) ? " term-candidate--selected" : ""}${exact ? " term-candidate--existing" : ""}`} key={candidate.id}>
          {editing ? <div className="term-candidate__editor">
            <label>分类<select value={candidate.category} onChange={(event) => updateCandidate(candidate.id, { category: event.target.value })}>{TERM_ANALYSIS_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>名称<input maxLength={100} value={candidate.label} onChange={(event) => updateCandidate(candidate.id, { label: event.target.value })} /></label>
            <label>插入内容<textarea maxLength={500} value={candidate.value} onChange={(event) => updateCandidate(candidate.id, { value: event.target.value })} /></label>
            <button type="button" onClick={() => setEditingId(null)}>完成编辑</button>
          </div> : <>
            <button className="term-candidate__toggle" type="button" aria-pressed={selected.has(candidate.id)} disabled={exact} onClick={() => toggle(candidate)}><strong>{candidate.label}</strong><span>{candidate.value}</span></button>
            <footer><span className={`term-confidence term-confidence--${candidate.confidence}`}>{candidate.confidence === "high" ? "高可信" : candidate.confidence === "medium" ? "中可信" : "待确认"}</span>{candidate.duplicate ? <span className={`term-duplicate term-duplicate--${candidate.duplicate.kind}`}>{exact ? "已收录" : `疑似重复：${candidate.duplicate.label}`}</span> : null}<button type="button" onClick={() => setEditingId(candidate.id)}>编辑</button></footer>
          </>}
        </article>;
      })}</div></section>)}
      {result.candidates.length ? <div className="term-analysis__bulk"><span>已选择 <strong>{selected.size}</strong> 项</span><button type="button" disabled={!eligible.length} onClick={() => setSelected(new Set(eligible.map((candidate) => candidate.id)))}>选择可收录项</button><button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>清空选择</button><button className="primary-action" type="button" disabled={!selected.size || saving} onClick={() => void saveSelected()}>{saving ? "正在收录…" : `批量收录 ${selected.size} 项`}</button></div> : null}
    </div> : null}
  </section>;
}
