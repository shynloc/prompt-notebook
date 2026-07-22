import { AppShell } from "@/components/app-shell/app-shell";
import { TemplateManager } from "@/components/productivity/template-manager";

export default function TemplatesPage() { return <AppShell><section className="notebook-page"><header className="notebook-heading"><div><span className="section-kicker">TEMPLATES</span><h2>变量模板</h2><p>把反复使用的提示词结构保存为模板，用变量快速生成新版本。</p></div></header><TemplateManager /></section></AppShell>; }
