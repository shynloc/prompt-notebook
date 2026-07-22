const destinations = [["作品库", "/notes"], ["收藏", "/favorites"], ["新建", "/notes/new"], ["AI 画室", "/imagehub"], ["词库", "/library"], ["我的", "/profile"]] as const;

export function MobileNav() { return <nav aria-label="移动主导航" className="mobile-navigation" data-testid="mobile-navigation">{destinations.map(([label, href]) => <a className={label === "新建" ? "mobile-navigation__create" : undefined} href={href} key={label}>{label}</a>)}</nav>; }
