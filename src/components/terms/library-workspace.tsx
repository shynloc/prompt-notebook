"use client";

import { useEffect, useState } from "react";

import { TermAnalysisWorkbench } from "./term-analysis-workbench";
import { TermLibrary } from "./term-library";

type Tab = "library" | "analyze";

export function LibraryWorkspace() {
  const [tab, setTab] = useState<Tab>("library");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("tab") === "analyze") setTab("analyze");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function select(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "analyze") url.searchParams.set("tab", "analyze"); else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }

  return <>
    <div className="library-mode-tabs" role="tablist" aria-label="提示词百科功能">
      <button aria-selected={tab === "library"} role="tab" type="button" onClick={() => select("library")}>提示词百科</button>
      <button aria-selected={tab === "analyze"} role="tab" type="button" onClick={() => select("analyze")}>✦ AI 提示词分析</button>
    </div>
    <div role="tabpanel" hidden={tab !== "library"}><TermLibrary refreshKey={refreshKey} /></div>
    <div role="tabpanel" hidden={tab !== "analyze"}><TermAnalysisWorkbench onSaved={() => setRefreshKey((value) => value + 1)} /></div>
  </>;
}
