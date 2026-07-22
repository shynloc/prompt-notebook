"use client";

import Link from "next/link";
import { useState } from "react";

export function ExtensionConnect({ codeChallenge, redirectUri, state, deviceName }: {
  codeChallenge: string;
  redirectUri: string;
  state: string;
  deviceName: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function redirect(params: Record<string, string>) {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    window.location.assign(url.toString());
  }

  async function approve() {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/v1/extension/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codeChallenge, redirectUri, deviceName }),
    });
    const body = await response.json();
    if (response.status === 401) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (!response.ok) {
      setMessage(body.error?.message ?? "无法连接插件，请重试。");
      setPending(false);
      return;
    }
    redirect({ code: body.data.code, state });
  }

  return (
    <main className="auth-page">
      <section className="auth-card extension-connect-card" aria-labelledby="extension-connect-title">
        <Link className="auth-brand" href="/">Prompt Notebook</Link>
        <p className="auth-eyebrow">Chrome extension</p>
        <h1 id="extension-connect-title">连接提示词笔记本</h1>
        <p className="auth-description">允许 <strong>{deviceName}</strong> 快速保存你主动选择的文字、标签和图片。</p>
        <ul className="extension-permissions">
          <li>新建提示词和读取你的标签</li>
          <li>导入你明确选择的网页图片</li>
          <li>不会读取密码、浏览历史或其他标签页</li>
        </ul>
        {message ? <p className="auth-message" role="alert">{message}</p> : null}
        <div className="extension-connect-actions">
          <button className="auth-submit" type="button" disabled={pending} onClick={() => void approve()}>{pending ? "正在连接…" : "允许并连接"}</button>
          <button type="button" onClick={() => redirect({ error: "access_denied", state })}>取消</button>
        </div>
      </section>
    </main>
  );
}

