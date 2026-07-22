const destinations = [
  ["全部提示词", "/notes", "▦"],
  ["收藏", "/favorites", "★"],
  ["归档", "/archive", "□"],
  ["回收站", "/trash", "↺"],
  ["分享管理", "/shares", "↗"],
  ["标签", "/tags", "#"],
  ["项目", "/projects", "P"],
  ["变量模板", "/templates", "T"],
  ["提示词百科", "/library", "✦"],
  ["AI 助手", "/settings/ai", "AI"],
  ["图床设置", "/settings/storage", "IMG"],
  ["AI ImageHub", "/imagehub", "◎"],
  ["新建 Prompt", "/notes/new", "+"],
] as const;

export function DesktopSidebar() {
  return <aside className="desktop-sidebar" data-testid="desktop-sidebar">
    <div className="sidebar-label">PROMPT / NOTES</div>
    <nav aria-label="桌面主导航" className="desktop-navigation">{destinations.map(([label, href, icon]) => <a href={href} key={label}><span aria-hidden="true">{icon}</span>{label}</a>)}</nav>
    <p className="sidebar-note">把灵感、提示词和生成作品留在同一本可搜索的手札里。</p>
  </aside>;
}
