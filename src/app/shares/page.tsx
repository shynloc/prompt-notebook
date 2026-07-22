import { AppShell } from "@/components/app-shell/app-shell";
import { ShareManagement } from "@/components/sharing/share-management";

export default function SharesPage() {
  return <AppShell><section className="notebook-page"><header className="notebook-heading"><div><span className="section-kicker">ACTIVE SHARES</span><h2>分享管理</h2><p>只显示仍在有效期内的分享。你可以续期七天，或让链接立即失效。</p></div></header><ShareManagement /></section></AppShell>;
}
