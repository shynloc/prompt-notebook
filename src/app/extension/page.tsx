import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chrome 扩展 | Prompt Notebook",
  description: "在网页上选中提示词，一键整理并保存到 Prompt Notebook。",
};

const features = [
  ["选中即收集", "选中文字后点击工具栏、右键菜单，或按 Alt + Shift + P，侧边栏会自动带入内容。"],
  ["智能寻找配图", "从正文附近和页面元数据中筛选候选图片，由你确认后才上传和保存。"],
  ["先编辑再入库", "标题、提示词、标签、来源和图片都可在侧边栏中调整，不会悄悄自动保存。"],
  ["权限保持克制", "仅在你的明确操作后临时读取当前页面，不申请浏览所有网站的长期权限。"],
] as const;

export default function ExtensionPage() {
  return <main className="extension-page">
    <nav className="extension-page__nav" aria-label="扩展页面导航">
      <a className="extension-page__brand" href="/notes">Prompt Notebook</a>
      <div className="extension-page__nav-links"><a href="/privacy">隐私说明</a><a className="primary-action" href="/notes">打开笔记本</a></div>
    </nav>

    <section className="extension-hero">
      <div className="extension-hero__copy">
        <span className="extension-kicker">CHROME · MANIFEST V3</span>
        <h1>看到好提示词，<br />顺手收进笔记本。</h1>
        <p className="extension-hero__lede">无需来回复制粘贴。选择网页中的提示词，检查自动识别的标题与配图，再从 Chrome 侧边栏直接保存到你的私人云端笔记本。</p>
        <div className="extension-actions">
          <a className="extension-actions__primary" href="https://github.com/shynloc/prompt-notebook/releases/latest/download/prompt-notebook-chrome.zip">从 GitHub 下载最新版</a>
          <a className="extension-actions__secondary" href="#install">查看安装步骤</a>
        </div>
      </div>
      <div className="extension-panel-demo" aria-label="扩展侧边栏界面示意图">
        <div className="extension-panel-demo__bar"><strong>保存到笔记本</strong><span>● 已连接</span></div>
        <div className="extension-panel-demo__selection">A cinematic portrait in warm window light, editorial composition, subtle film grain…</div>
        <div className="extension-panel-demo__field">标题 · 暖光电影感人像</div>
        <div className="extension-panel-demo__field">标签 · 人像　摄影　电影感</div>
        <div className="extension-panel-demo__images"><span /><span /><span /></div>
      </div>
    </section>

    <section className="extension-features" aria-label="扩展功能">
      {features.map(([title, copy]) => <article className="extension-feature" key={title}><strong>{title}</strong><p>{copy}</p></article>)}
    </section>

    <section className="install-card" id="install">
      <span className="extension-kicker">开发者模式安装</span>
      <h2>安装最新版</h2>
      <ol>
        <li>下载 ZIP 并解压到一个不会随意删除的文件夹。</li>
        <li>在 Chrome 地址栏打开 <code>chrome://extensions</code>，开启右上角“开发者模式”。</li>
        <li>点击“加载已解压的扩展程序”，选择刚才解压出的文件夹。</li>
        <li>在任意网页选中文字，点击扩展图标；首次使用按提示连接 Prompt Notebook 账户。</li>
      </ol>
      <p>扩展首次打开不会连接任何固定网站；请先输入并验证你自己的 Prompt Notebook 服务器地址。</p>
    </section>
  </main>;
}
