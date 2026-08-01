"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { DashboardSnapshot, DashboardSummary } from "@/modules/dashboard/dashboard-types";

const metrics: Array<{
  key: keyof DashboardSummary;
  label: string;
  href?: string;
}> = [
  { key: "totalNotes", label: "总提示词笔记数量", href: "/notes" },
  { key: "activeSharedNotes", label: "分享中的提示词数量", href: "/shares" },
  { key: "totalTags", label: "总标签数", href: "/tags" },
  { key: "totalTerms", label: "总百科词汇量", href: "/library" },
  { key: "totalFavorites", label: "总收藏数量", href: "/favorites" },
  { key: "totalProjects", label: "总项目数量", href: "/projects" },
  { key: "trashNotes", label: "回收站内数量", href: "/trash" },
  { key: "totalPromptCharacters", label: "总提示词字数合计" },
];

const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = <><span>{label}</span><strong>{numberFormatter.format(value)}</strong></>;
  return href
    ? <Link className="dashboard-stat-card" data-testid="dashboard-stat-card" href={href}>{content}</Link>
    : <article className="dashboard-stat-card" data-testid="dashboard-stat-card">{content}</article>;
}

export function DashboardView() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/v1/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        setSnapshot(null);
        setState("unauthenticated");
        return;
      }
      if (!response.ok) throw new Error("Dashboard request failed");
      const body = await response.json() as { data?: DashboardSnapshot };
      if (!body.data) throw new Error("Dashboard response was incomplete");
      setSnapshot(body.data);
      setState("ready");
    } catch {
      setSnapshot(null);
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <section className="notebook-page dashboard-page">
    <header className="notebook-heading dashboard-heading">
      <div>
        <span className="section-kicker">NOTEBOOK OVERVIEW</span>
        <h2>Dashboard</h2>
        <p>快速查看提示词、分享、标签、百科词汇和项目的整体规模。</p>
      </div>
      {state === "ready" ? <button className="dashboard-refresh" type="button" onClick={() => void load()}>刷新数据</button> : null}
    </header>

    {state === "loading" ? <div className="dashboard-stat-grid" data-testid="dashboard-stat-grid" aria-label="正在加载仪表盘数据" aria-busy="true">
      {metrics.map((metric) => <article className="dashboard-stat-card dashboard-stat-card--loading" data-testid="dashboard-stat-card" key={metric.key} aria-hidden="true"><span /><strong /></article>)}
    </div> : null}

    {state === "unauthenticated" ? <div className="dashboard-state"><strong>登录后查看你的仪表盘</strong><p>统计数据只属于当前账户，不会与其他用户混合。</p><Link className="primary-action" href="/sign-in">登录或创建账户</Link></div> : null}
    {state === "error" ? <div className="dashboard-state" role="alert"><strong>暂时无法读取仪表盘</strong><p>你的笔记数据没有受到影响，请稍后重试。</p><button type="button" onClick={() => void load()}>重新加载</button></div> : null}

    {state === "ready" && snapshot ? <>
      <div className="dashboard-stat-grid" data-testid="dashboard-stat-grid" aria-label="笔记本统计数据">
        {metrics.map((metric) => <StatCard key={metric.key} label={metric.label} value={snapshot.summary[metric.key]} href={metric.href} />)}
      </div>

      <section className="dashboard-tag-section" aria-labelledby="dashboard-tags-title">
        <header><div><span className="section-kicker">TAG DISTRIBUTION</span><h3 id="dashboard-tags-title">各标签下的提示词笔记数量</h3></div><Link href="/tags">管理标签</Link></header>
        {snapshot.tags.length ? <div className="dashboard-table-wrap">
          <table>
            <thead><tr><th scope="col">标签</th><th scope="col">数量</th></tr></thead>
            <tbody>{snapshot.tags.map((tag) => <tr key={tag.id}><th scope="row"><Link href={`/tags/${tag.id}`}>{tag.name}</Link></th><td>{numberFormatter.format(tag.noteCount)}</td></tr>)}</tbody>
          </table>
        </div> : <div className="dashboard-tag-empty"><p>还没有标签。为提示词添加标签后，分布会显示在这里。</p><Link href="/notes/new">新建 Prompt</Link></div>}
      </section>
    </> : null}
  </section>;
}
