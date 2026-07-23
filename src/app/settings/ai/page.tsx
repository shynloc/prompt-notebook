import { AiConfigurationManager } from "@/components/ai/ai-configuration-manager";
import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsLayout } from "@/components/settings/settings-layout";

export default function AiSettingsPage() {
  return (
    <AppShell>
      <SettingsLayout active="ai" kicker="AI ASSISTANT" title="AI 模型" intro="保存多套模型连接，并分别指定用于提示词优化、词库分析、生图和图片反推的模型。">
        <AiConfigurationManager />
      </SettingsLayout>
    </AppShell>
  );
}
