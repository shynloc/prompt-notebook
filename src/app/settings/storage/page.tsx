import { AppShell } from "@/components/app-shell/app-shell";
import { StorageConfigurationManager } from "@/components/media/storage-configuration-manager";
import { SettingsLayout } from "@/components/settings/settings-layout";

export default function StorageSettingsPage() {
  return <AppShell><SettingsLayout active="storage" kicker="IMAGE STORAGE" title="图床" intro="为当前账号连接独立图片存储。笔记封面、网页图片导入和 ImageHub 生成作品都会使用这里的配置。">
    <StorageConfigurationManager />
  </SettingsLayout></AppShell>;
}
