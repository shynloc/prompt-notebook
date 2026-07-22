"use client";

import { useEffect, useState, type FormEvent } from "react";

interface StorageSetting {
  providerType: "picbed";
  endpoint: string;
  tokenHint: string;
  enabled: boolean;
  lastTestStatus: "success" | "failed" | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
}

function errorMessage(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
  const error = (body as { error?: unknown }).error;
  return typeof error === "object" && error !== null && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : fallback;
}

export function StorageConfigurationManager() {
  const [setting, setSetting] = useState<StorageSetting | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function applyResponse(response: Response) {
    if (response.status === 401) {
      window.location.assign("/sign-in?returnTo=/settings/storage");
      return;
    }
    const body = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, "图床配置加载失败，请稍后重试。"));
    const next = body.data as StorageSetting | null;
    setSetting(next);
    setEndpoint(next?.endpoint ?? "");
    setEnabled(next?.enabled ?? true);
  }

  async function load() {
    await applyResponse(await fetch("/api/v1/settings/storage", { cache: "no-store" }));
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/settings/storage", { cache: "no-store" })
      .then(async (response) => { if (active) await applyResponse(response); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "图床配置加载失败。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setting && !token) { setError("首次配置时必须填写访问令牌。"); return; }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/settings/storage", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerType: "picbed", endpoint, enabled, ...(token ? { token } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "图床配置保存失败。"));
      setToken("");
      setMessage("图床配置已加密保存。现在可以上传图片并运行 ImageHub。");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图床配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/settings/storage/test", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "图床连接测试失败。"));
      setMessage("连接成功：测试图片已上传并可正常读取。");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图床连接测试失败。");
      await load().catch(() => undefined);
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!window.confirm("删除图床配置？已保存的令牌会一并删除，已有笔记不会被删除。")) return;
    const response = await fetch("/api/v1/settings/storage", { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(errorMessage(body, "图床配置删除失败。")); return; }
    setSetting(null);
    setEndpoint("");
    setToken("");
    setEnabled(true);
    setMessage("图床配置已删除。");
  }

  if (loading) return <div className="storage-settings-card" role="status">正在加载图床配置…</div>;

  return (
    <div className="storage-settings-layout">
      <form className="storage-settings-card storage-settings-form" onSubmit={save}>
        <div className="ai-panel-heading">
          <div><span className="section-kicker">PICBED</span><h3>{setting ? "编辑图床配置" : "连接图片存储"}</h3></div>
          {setting ? <span className={setting.enabled ? "ai-status ai-status--enabled" : "ai-status"}>{setting.enabled ? "已启用" : "已停用"}</span> : null}
        </div>
        <label>图床上传端点<input required type="url" maxLength={2048} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://images.example.com/upload" /></label>
        <label>访问令牌<input required={!setting} type="password" autoComplete="new-password" maxLength={10000} value={token} onChange={(event) => setToken(event.target.value)} placeholder={setting ? `留空则保留已加密令牌 ${setting.tokenHint}` : "输入图床访问令牌"} /></label>
        <label className="storage-settings-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>启用这套图床配置</span></label>
        <p className="ai-security-note">端点必须使用公开 HTTPS 地址。令牌只在服务端加密保存，不会返回浏览器或写入代码仓库。</p>
        <div className="storage-settings-actions">
          <button className="primary-action" disabled={saving} type="submit">{saving ? "正在加密保存…" : "保存图床配置"}</button>
          {setting ? <button disabled={testing || !setting.enabled} type="button" onClick={() => void testConnection()}>{testing ? "正在上传测试图…" : "测试连接"}</button> : null}
          {setting ? <button className="danger-text" type="button" onClick={() => void remove()}>删除配置</button> : null}
        </div>
        {message ? <p className="ai-message ai-message--success" role="status">{message}</p> : null}
        {error ? <p className="ai-message ai-message--error" role="alert">{error}</p> : null}
      </form>
      <aside className="storage-settings-card storage-settings-help">
        <span className="section-kicker">COMPATIBILITY</span><h3>兼容接口约定</h3>
        <p>应用以 <code>multipart/form-data</code> 上传 <code>file</code> 与 <code>path</code>，并在 <code>X-Auth-Token</code> 请求头中发送令牌。</p>
        <p>JSON 可包含 <code>url</code>、<code>publicUrl</code>、<code>href</code>、<code>location</code>、<code>key</code> 或 <code>path</code>。返回图片必须能通过公网 HTTPS 读取。</p>
        {setting?.lastTestedAt ? <div className={`storage-test-result storage-test-result--${setting.lastTestStatus}`}><strong>{setting.lastTestStatus === "success" ? "最近测试成功" : "最近测试失败"}</strong><span>{setting.lastTestMessage}</span><small>{new Date(setting.lastTestedAt).toLocaleString("zh-CN")}</small></div> : null}
      </aside>
    </div>
  );
}
