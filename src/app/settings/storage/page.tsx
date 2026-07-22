import { AppShell } from "@/components/app-shell/app-shell";
import { StorageConfigurationManager } from "@/components/media/storage-configuration-manager";

export default function StorageSettingsPage() {
  return <AppShell><section className="notebook-page">
    <header className="notebook-heading"><div><span className="section-kicker">IMAGE STORAGE</span><h2>图床设置</h2><p>为当前账号连接独立图片存储。笔记封面、网页图片导入和 ImageHub 生成作品都会使用这里的配置。</p></div></header>
    <StorageConfigurationManager />
  </section></AppShell>;
}
