import type { ReactNode } from "react";
import { SessionControls } from "@/components/auth/session-controls";
import { SyncStatus } from "@/components/ui/sync-status";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNav } from "./mobile-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">
    <DesktopSidebar />
    <div className="app-shell__main">
      <header className="topbar">
        <a className="brand" href="/notes"><span className="topbar__eyebrow">~/prompt-notebook</span><h1>Prompt Notebook</h1></a>
        <div className="topbar__actions"><SyncStatus /><SessionControls /><a className="primary-action" href="/notes/new">新建 Prompt</a></div>
      </header>
      <main className="workspace">{children}</main>
    </div>
    <MobileNav />
  </div>;
}
