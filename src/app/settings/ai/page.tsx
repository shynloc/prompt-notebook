import { AiConfigurationManager } from "@/components/ai/ai-configuration-manager";
import { AppShell } from "@/components/app-shell/app-shell";

export default function AiSettingsPage() {
  return (
    <AppShell>
      <section className="notebook-page ai-settings-page">
        <header className="notebook-heading">
          <div>
            <span className="section-kicker">AI ASSISTANT</span>
            <h2>AI 助手配置</h2>
            <p>保存多套模型连接，并分别指定用于提示词优化、生图和图片反推的默认模型。</p>
          </div>
        </header>
        <AiConfigurationManager />
      </section>
    </AppShell>
  );
}
