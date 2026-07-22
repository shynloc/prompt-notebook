import { AppShell } from "@/components/app-shell/app-shell";
import { DangerZone } from "@/components/account/danger-zone";
import { DataTransfer } from "@/components/account/data-transfer";
import { StorageStatus } from "@/components/account/storage-status";
import { SessionControls } from "@/components/auth/session-controls";
import { DeviceManager } from "@/components/extension/device-manager";

export default function ProfilePage() {
  return (
    <AppShell>
      <section className="notebook-page">
        <header className="notebook-heading"><div><span className="section-kicker">ACCOUNT</span><h2>我的账户</h2><p>账户用于在桌面端、移动端和浏览器插件之间安全同步提示词、标签和图片引用。</p></div></header>
        <div className="notebook-intro"><h3>登录状态</h3><SessionControls /><p>退出登录不会删除云端内容。再次登录后，笔记会从 PostgreSQL 重新读取。</p></div>
        <div className="notebook-intro"><h3>AI 助手</h3><p>配置用于提示词优化、图片生成和图片反推的大模型。API Key 只在服务端加密保存。</p><p><a className="primary-action" href="/settings/ai">管理 AI 助手配置</a></p></div>
        <div className="notebook-intro"><h3>图床</h3><p>为笔记图片、网页图片导入和 ImageHub 作品配置独立图片存储。令牌只在服务端加密保存。</p><p><a className="primary-action" href="/settings/storage">管理图床配置</a></p></div>
        <StorageStatus />
        <DataTransfer />
        <DeviceManager />
        <DangerZone />
      </section>
    </AppShell>
  );
}
