import { AiConfigurationManager } from "@/components/ai/ai-configuration-manager";
import { AppShell } from "@/components/app-shell/app-shell";
import { SettingsLayout } from "@/components/settings/settings-layout";

export default function AiSettingsPage() {
  return (
    <AppShell>
      <SettingsLayout active="ai" kicker="AI PROVIDER SERVICES" title="大模型配置" intro="保存多套模型服务连接，并分别指定用于提示词优化、词库分析、生图和图片反推的模型，和 AI 模特资产保持清晰区分。">
        <AiConfigurationManager />
      </SettingsLayout>
    </AppShell>
  );
}
