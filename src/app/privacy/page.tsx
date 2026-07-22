import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隐私说明 | Prompt Notebook",
  description: "Prompt Notebook 网站与 Chrome 扩展的数据和权限说明。",
};

export default function PrivacyPage() {
  return <main className="extension-page">
    <nav className="extension-page__nav" aria-label="隐私页面导航"><a className="extension-page__brand" href="/notes">Prompt Notebook</a><div className="extension-page__nav-links"><a href="/extension">Chrome 扩展</a><a href="/notes">返回笔记本</a></div></nav>
    <article className="privacy-copy">
      <span className="extension-kicker">PRIVACY · 2026-07-19</span>
      <h1>隐私说明</h1>
      <p>Prompt Notebook 是一款私人提示词笔记本。网站和 Chrome 扩展只处理提供功能所必需的数据，不出售个人数据，也不使用扩展收集广告或跨网站行为分析数据。</p>

      <h2>我们处理哪些数据</h2>
      <ul>
        <li>账户数据：注册和登录所需的邮箱、昵称及安全凭证。</li>
        <li>笔记数据：你主动保存的标题、提示词、标签、来源网页和所选图片。</li>
        <li>设备授权：扩展设备名称、最后使用时间及撤销状态；访问令牌仅以不可逆摘要形式保存在服务端。</li>
      </ul>

      <h2>扩展何时读取网页</h2>
      <p>扩展仅在你点击工具栏、选择右键菜单或使用快捷键后，凭 Chrome 的临时 <code>activeTab</code> 权限读取当前页中选中的文字、附近标题、网页地址和候选图片信息。它不会持续监听浏览记录，也不会读取网站登录 Cookie。</p>

      <h2>图片与网络请求</h2>
      <p>候选图片先在本地侧边栏中展示。只有你勾选图片并点击保存后，网站服务端才会尝试导入图片到配置的图片存储服务。扩展的网络访问范围限定为 Prompt Notebook 服务域名。</p>

      <h2>存储、控制与删除</h2>
      <p>笔记保存在账户对应的数据库中，扩展的未保存草稿与登录令牌保存在 Chrome 本地扩展存储中。你可以删除笔记，并可在<a href="/profile">个人资料页</a>查看或撤销扩展设备；撤销后该设备必须重新授权。</p>

      <h2>安全措施</h2>
      <p>扩展使用 PKCE 授权、短期访问令牌和可轮换刷新令牌；网站对捕获接口执行身份校验、速率限制与幂等保护。服务端不保存明文扩展令牌。</p>

      <h2>变更</h2>
      <p>当数据用途或权限发生实质变化时，本页会同步更新日期和说明。源代码中的权限清单始终是扩展实际权限的最终依据。</p>
    </article>
  </main>;
}
