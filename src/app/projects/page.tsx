import { AppShell } from "@/components/app-shell/app-shell";
import { ProjectManager } from "@/components/productivity/project-manager";

export default function ProjectsPage() { return <AppShell><section className="notebook-page"><header className="notebook-heading"><div><span className="section-kicker">PROJECTS</span><h2>项目与智能集合</h2><p>按工作、客户或创作主题组织提示词；智能集合保存筛选条件，不复制笔记内容。</p></div></header><ProjectManager /></section></AppShell>; }
