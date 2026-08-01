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
        <div className="notebook-intro"><h3>数据仪表盘</h3><p>查看提示词、分享、标签、百科词汇、收藏和项目的整体规模。</p><p><a className="primary-action" href="/dashboard">进入 Dashboard</a></p></div>
        <div className="notebook-intro"><h3>登录状态</h3><SessionControls /><p>退出登录不会删除云端内容。再次登录后，笔记会从 PostgreSQL 重新读取。</p></div>
        <div className="notebook-intro"><h3>服务设置</h3><p>集中配置 AI 模型与图床。API Key 和图床令牌只在服务端加密保存。</p><p><a className="primary-action" href="/settings">进入设置</a></p></div>
        <div className="notebook-intro"><h3>提示词分享</h3><p>查看仍在有效期内的只读分享，并统一续期或关闭。</p><p><a className="primary-action" href="/shares">进入分享管理</a></p></div>
        <StorageStatus />
        <DataTransfer />
        <DeviceManager />
        <DangerZone />
      </section>
    </AppShell>
  );
}
