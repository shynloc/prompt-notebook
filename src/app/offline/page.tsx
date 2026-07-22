import Link from "next/link";

export default function OfflinePage() { return <main className="auth-page"><section className="auth-card"><p className="auth-eyebrow">OFFLINE</p><h1>暂时无法连接</h1><p className="auth-description">请检查网络后重试。已经保存到云端的提示词不会丢失。</p><Link className="primary-action" href="/notes">重新加载作品库</Link></section></main>; }
