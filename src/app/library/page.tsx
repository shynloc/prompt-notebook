import { AppShell } from "@/components/app-shell/app-shell";
import { TermLibrary } from "@/components/terms/term-library";

export default function LibraryPage() { return <AppShell><div className="library-page"><header className="notebook-heading"><div><span className="section-kicker">PROMPT WIKI</span><h2>提示词百科词库</h2><p>按类别浏览常用词汇，或管理你自己的词条。新建和编辑提示词时可以直接点击插入。</p></div></header><TermLibrary /></div></AppShell>; }
