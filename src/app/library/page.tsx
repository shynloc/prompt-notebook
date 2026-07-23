import { AppShell } from "@/components/app-shell/app-shell";
import { LibraryWorkspace } from "@/components/terms/library-workspace";

export default function LibraryPage() { return <AppShell><div className="library-page"><header className="notebook-heading"><div><span className="section-kicker">PROMPT WIKI</span><h2>提示词百科词库</h2><p>浏览和管理词条，或让 AI 从优秀的完整 Prompt 中提炼可复用描述。</p></div></header><LibraryWorkspace /></div></AppShell>; }
