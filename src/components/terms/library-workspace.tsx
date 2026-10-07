"use client";

import { useEffect, useState } from "react";

import { TermAnalysisWorkbench } from "./term-analysis-workbench";
import { TermLibrary } from "./term-library";
import { ReversePromptWorkbench } from "@/components/ai/reverse-prompt-workbench";
import { storePromptHandoff, takePromptHandoff } from "@/modules/sync/prompt-handoff";

type Tab = "library" | "analyze" | "reverse";

export function LibraryWorkspace() {
  const [tab, setTab] = useState<Tab>("library");
  const [refreshKey, setRefreshKey] = useState(0);
  const [analysisSeed, setAnalysisSeed] = useState<{ prompt: string; version: number }>({ prompt: "", version: 0 });
  const [analysisHasContent, setAnalysisHasContent] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("tab");
      if (mode === "analyze" || mode === "reverse") setTab(mode);
      const handoff = takePromptHandoff(params.get("handoff"), "analyze");
      if (handoff) { setAnalysisSeed({ prompt: handoff.prompt, version: 1 }); setAnalysisHasContent(Boolean(handoff.prompt)); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function select(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next !== "library") url.searchParams.set("tab", next); else url.searchParams.delete("tab");
    url.searchParams.delete("handoff");
    window.history.replaceState(null, "", url);
  }

  return <>
    <div className="library-mode-tabs" role="tablist" aria-label="提示词百科功能">
      <button aria-selected={tab === "library"} role="tab" type="button" onClick={() => select("library")}>提示词百科</button>
      <button aria-selected={tab === "analyze"} role="tab" type="button" onClick={() => select("analyze")}>✦ AI 提示词分析</button>
      <button aria-selected={tab === "reverse"} role="tab" type="button" onClick={() => select("reverse")}>图片反推</button>
    </div>
    <div role="tabpanel" hidden={tab !== "library"}><TermLibrary refreshKey={refreshKey} /></div>
    <div role="tabpanel" hidden={tab !== "analyze"}><TermAnalysisWorkbench key={analysisSeed.version} initialPrompt={analysisSeed.prompt} onPromptChange={(value) => setAnalysisHasContent(Boolean(value.trim()))} onSaved={() => setRefreshKey((value) => value + 1)} /></div>
    <div className="library-reverse" role="tabpanel" hidden={tab !== "reverse"}><ReversePromptWorkbench onUse={(value) => { const id = storePromptHandoff("imagehub", value.prompt, value.negativePrompt); window.location.assign(`/imagehub?handoff=${id}`); }} onAnalyzeTerms={(prompt) => {
      if (analysisHasContent && !window.confirm("百科分析区已有输入。是否用本次反推提示词替换，并重新选择待收录词条？")) return;
      setAnalysisSeed((current) => ({ prompt, version: current.version + 1 })); setAnalysisHasContent(true); select("analyze");
    }} /></div>
  </>;
}
