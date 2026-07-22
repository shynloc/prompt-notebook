"use client";

import { useState } from "react";

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function removeAccount() {
    setPending(true); setMessage("");
    const response = await fetch("/api/v1/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, confirmation }),
    });
    const result = await response.json();
    setPending(false);
    if (response.ok) { window.location.assign("/"); return; }
    setMessage(result.error?.message ?? "账户删除失败");
  }

  return (
    <section className="device-manager danger-zone" aria-labelledby="danger-zone-title">
      <div><span className="section-kicker">DANGER ZONE</span><h3 id="danger-zone-title">永久删除账户</h3><p>这会删除账户、笔记、标签、图片引用和插件授权。图床中的远端文件不会被自动删除。请先导出备份。</p></div>
      {!open ? <button className="danger-action" type="button" onClick={() => setOpen(true)}>开始删除账户</button> : (
        <div className="danger-zone__form">
          <label>当前密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>输入 <strong>DELETE MY ACCOUNT</strong><input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <div className="data-transfer__actions">
            <button type="button" onClick={() => setOpen(false)}>取消</button>
            <button className="danger-action" disabled={pending || !password || confirmation !== "DELETE MY ACCOUNT"} type="button" onClick={() => void removeAccount()}>{pending ? "正在删除…" : "永久删除"}</button>
          </div>
        </div>
      )}
      {message ? <p className="form-message" role="alert">{message}</p> : null}
    </section>
  );
}
