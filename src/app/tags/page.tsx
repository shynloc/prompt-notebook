import { AppShell } from "@/components/app-shell/app-shell";
import { TagManager } from "@/components/tags/tag-manager";

export default function TagsPage() { return <AppShell><section className="notebook-page"><header className="notebook-heading"><div><span className="section-kicker">TAGS</span><h2>标签</h2><p>使用标签整理不同模型、用途、风格和项目的提示词集合。</p></div></header><TagManager /></section></AppShell>; }
