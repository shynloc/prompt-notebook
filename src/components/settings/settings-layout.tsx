import Link from "next/link";
import type { ReactNode } from "react";

const tabs = [
  { id: "ai", label: "模型服务", href: "/settings/ai" },
  { id: "storage", label: "图床", href: "/settings/storage" },
] as const;

export function SettingsLayout({
  active,
  kicker,
  title,
  intro,
  children,
}: {
  active: (typeof tabs)[number]["id"];
  kicker: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return <section className="settings-page">
    <header className="notebook-heading settings-page__heading">
      <div><span className="section-kicker">SETTINGS</span><h2>设置</h2><p>集中管理大模型服务、图床以及 Prompt Notebook 的外部连接。</p></div>
    </header>
    <nav className="settings-tabs" aria-label="设置分类">
      {tabs.map((tab) => <Link aria-current={active === tab.id ? "page" : undefined} href={tab.href} key={tab.id}>{tab.label}</Link>)}
    </nav>
    <header className="settings-section-heading">
      <span className="section-kicker">{kicker}</span>
      <h3>{title}</h3>
      <p>{intro}</p>
    </header>
    {children}
  </section>;
}
