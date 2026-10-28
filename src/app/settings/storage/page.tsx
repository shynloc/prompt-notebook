import { AppShell } from "@/components/app-shell/app-shell";
import { StorageConfigurationManager } from "@/components/media/storage-configuration-manager";
import { SettingsLayout } from "@/components/settings/settings-layout";

export default function StorageSettingsPage() {
  return <AppShell><SettingsLayout active="storage" kicker="IMAGE STORAGE" title="图片存储" intro="使用站点本地存储，或连接自己的外部图床。保存后，笔记封面、参考图、角色图片和生成作品的新上传会使用所选方式。">
    <StorageConfigurationManager />
  </SettingsLayout></AppShell>;
}
