"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type StorageProvider = "local" | "picbed";
interface StorageSetting {
  providerType: StorageProvider;
  endpoint: string;
  tokenHint: string;
  enabled: boolean;
  picbedConfigured: boolean;
  local: { usedBytes: number; quotaBytes: number };
  lastTestStatus: "success" | "failed" | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
}

function errorMessage(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
  const error = (body as { error?: unknown }).error;
  return typeof error === "object" && error !== null && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message : fallback;
}

function storageSetting(value: unknown): StorageSetting {
  if (!value || typeof value !== "object" || !("providerType" in value)
    || !["local", "picbed"].includes(String(value.providerType))) throw new Error("图片存储配置响应无效，请刷新后重试。");
  const next = value as Partial<StorageSetting> & { providerType: StorageProvider };
  return {
    providerType: next.providerType,
    endpoint: typeof next.endpoint === "string" ? next.endpoint : "",
    tokenHint: typeof next.tokenHint === "string" ? next.tokenHint : "",
    enabled: next.enabled !== false,
    picbedConfigured: next.picbedConfigured ?? next.providerType === "picbed",
    local: {
      usedBytes: Number.isSafeInteger(next.local?.usedBytes) && Number(next.local?.usedBytes) >= 0 ? Number(next.local?.usedBytes) : 0,
      quotaBytes: Number.isSafeInteger(next.local?.quotaBytes) && Number(next.local?.quotaBytes) > 0 ? Number(next.local?.quotaBytes) : 1024 ** 3,
    },
    lastTestStatus: next.lastTestStatus === "success" || next.lastTestStatus === "failed" ? next.lastTestStatus : null,
    lastTestMessage: typeof next.lastTestMessage === "string" ? next.lastTestMessage : null,
    lastTestedAt: typeof next.lastTestedAt === "string" ? next.lastTestedAt : null,
  };
}

export function formatStorageBytes(value: number) {
  if (value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${Number((value / 1024 ** unit).toFixed(unit ? 1 : 0))} ${units[unit]}`;
}

export function StorageConfigurationManager() {
  const router = useRouter();
  const mounted = useRef(true);
  const action = useRef<"save" | "test" | "remove" | null>(null);
  const [setting, setSetting] = useState<StorageSetting | null>(null);
  const [providerType, setProviderType] = useState<StorageProvider>("local");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"save" | "test" | "remove" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function applySetting(value: unknown) {
    const next = storageSetting(value);
    if (mounted.current) {
      setSetting(next);
      setProviderType(next.providerType);
      setEndpoint(next.endpoint);
      setEnabled(next.enabled);
    }
    return next;
  }
  async function responseBody(response: Response, fallback: string) {
    if (response.status === 401) { router.push("/sign-in?returnTo=/settings/storage"); throw new Error("请登录后管理图片存储。"); }
    const body = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, fallback));
    return body;
  }
  async function load(signal?: AbortSignal) {
    const body = await responseBody(await fetch("/api/v1/settings/storage", { cache: "no-store", signal }), "图片存储配置加载失败，请稍后重试。");
    if (!signal?.aborted) return applySetting(body.data);
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal)
      .catch((caught) => { if (!controller.signal.aborted && mounted.current) setError(caught instanceof Error ? caught.message : "图片存储配置加载失败。"); })
      .finally(() => { if (!controller.signal.aborted && mounted.current) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
    // Initial configuration loads once; mutations explicitly refresh it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function begin(next: NonNullable<typeof pending>) {
    if (action.current) return false;
    action.current = next;
    setPending(next); setMessage(""); setError("");
    return true;
  }
  function finish() { action.current = null; if (mounted.current) setPending(null); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (providerType === "picbed" && !setting?.picbedConfigured && !token.trim()) { setError("首次连接外部图床时必须填写访问令牌。"); return; }
    if (!setting || !begin("save")) return;
    try {
      const body = await responseBody(await fetch("/api/v1/settings/storage", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(providerType === "local" ? { providerType: "local" } : { providerType: "picbed", endpoint, enabled, ...(token ? { token } : {}) }),
      }), "图片存储配置保存失败。");
      const saved = body.data?.providerType ? applySetting(body.data) : await load();
      if (!saved) throw new Error("未能确认已保存的图片存储状态，请重新加载。");
      if (mounted.current) {
        setToken("");
        setMessage(saved.providerType === "local" ? "已切换到站点本地存储。后续上传将保存在运行本站的设备，已有图片不会迁移。"
          : saved.enabled ? "外部图床配置已加密保存。后续上传使用此配置，已有图片不会迁移。"
            : "外部图床配置已加密保存并停用。当前不能上传图片，请重新启用或切换到站点本地存储。");
      }
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "图片存储配置保存失败。"); }
    finally { finish(); }
  }
  async function testConnection() {
    if (!setting || !begin("test")) return;
    try {
      await responseBody(await fetch("/api/v1/settings/storage/test", { method: "POST" }), "图片存储测试失败。");
      await load();
      if (mounted.current) setMessage(setting.providerType === "local" ? "本地存储测试成功：已完成写入、读取和清理测试，不占用永久配额。" : "外部图床连接成功：测试图片已上传并可正常读取。");
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "图片存储测试失败。");
      await load().catch(() => undefined);
    } finally { finish(); }
  }
  async function remove() {
    if (action.current || !window.confirm("删除外部图床配置？已加密令牌会删除，并切回站点本地存储。已有图片不会迁移或自动删除。")) return;
    if (!begin("remove")) return;
    try {
      const body = await responseBody(await fetch("/api/v1/settings/storage", { method: "DELETE" }), "外部图床配置删除失败。");
      if (body.data?.providerType) applySetting(body.data); else await load();
      if (mounted.current) { setToken(""); setMessage("外部图床配置已删除，后续上传使用站点本地存储。"); }
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "外部图床配置删除失败。"); }
    finally { finish(); }
  }

  if (loading) return <div className="storage-settings-card" role="status">正在加载图片存储…</div>;
  if (!setting) return <div className="storage-settings-card"><p className="ai-message ai-message--error" role="alert">{error || "图片存储配置暂时不可用。"}</p><button type="button" onClick={() => { setLoading(true); setError(""); void load().catch((caught) => setError(caught instanceof Error ? caught.message : "配置加载失败。")).finally(() => setLoading(false)); }}>重新加载</button></div>;
  const dirty = providerType !== setting.providerType || providerType === "picbed" && (endpoint !== setting.endpoint || enabled !== setting.enabled || Boolean(token));
  const usage = Math.min(100, Math.max(0, setting.local.usedBytes / setting.local.quotaBytes * 100));
  const providerName = setting.providerType === "local" ? "站点本地存储" : "外部图床";
  const disabledExternal = setting.providerType === "picbed" && !setting.enabled;

  return <div className="storage-settings-layout">
    <form className="storage-settings-card storage-settings-form" onSubmit={save} aria-busy={Boolean(pending)}>
      <div className="ai-panel-heading"><div><span className="section-kicker">IMAGE STORAGE</span><h3>图片放在哪里</h3></div><span className={disabledExternal ? "ai-status" : "ai-status ai-status--enabled"}>{disabledExternal ? "外部图床已停用" : `当前：${providerName}`}</span></div>
      <fieldset className="storage-provider-options" disabled={Boolean(pending)}>
        <legend>选择图片存储方式</legend>
        <label className={`storage-provider-option${providerType === "local" ? " storage-provider-option--selected" : ""}`}><input type="radio" name="storage-provider" value="local" aria-label="站点本地存储" checked={providerType === "local"} onChange={() => { setProviderType("local"); setMessage(""); setError(""); }} /><span><strong>站点本地存储 <small>无需图床</small></strong><span>保存在本站运行设备的磁盘或 Docker 持久卷，开箱即可上传。</span></span></label>
        <label className={`storage-provider-option${providerType === "picbed" ? " storage-provider-option--selected" : ""}`}><input type="radio" name="storage-provider" value="picbed" aria-label="外部图床" checked={providerType === "picbed"} onChange={() => { setProviderType("picbed"); setMessage(""); setError(""); }} /><span><strong>外部图床 <small>自带连接</small></strong><span>使用你自己的兼容图床，令牌按账户加密保存。</span></span></label>
      </fieldset>
      <div className={`storage-selection-note${disabledExternal && !dirty ? " storage-selection-note--disabled" : ""}`} role="note"><strong>{dirty ? "尚未保存" : disabledExternal ? "外部图床已停用，当前不能上传" : `正在使用${providerName}`}</strong><span>{disabledExternal && !dirty ? "请重新启用外部图床并保存，或切换到站点本地存储。已有图片仍保留在原位置，不会自动迁移。" : "更改仅在保存成功后生效，只影响后续上传；已有图片保持原位置，不会自动迁移。"}</span></div>
      {providerType === "local" ? <section className="storage-local-summary" aria-label="本地存储用量">
        <div><span className="section-kicker">LOCAL QUOTA</span><strong>当前账户的图片空间</strong></div>
        <dl><div><dt>已用</dt><dd>{formatStorageBytes(setting.local.usedBytes)}</dd></div><div><dt>配额</dt><dd>{formatStorageBytes(setting.local.quotaBytes)}</dd></div></dl>
        <progress aria-label="本地存储使用率" max={100} value={usage} />
        <p>“本地”指运行本站的设备，不是浏览器缓存。电脑部署时为本机数据卷，服务器部署时为服务器磁盘；更换设备或清理浏览器缓存不会删除图片。</p>
        <p>删除笔记或移除图片引用不会自动释放存储空间；配额按保留的文件计算，清理需管理员确认，以免误删仍被其他笔记、角色或版本使用的图片。</p>
        {setting.picbedConfigured ? <p>之前的外部图床连接已保留，切回外部图床时无需重新输入令牌。</p> : null}
      </section> : <div className="storage-external-fields">
        <label>图床上传端点<input disabled={Boolean(pending)} required type="url" maxLength={2048} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://images.example.com/upload" /></label>
        <label>访问令牌<input disabled={Boolean(pending)} required={!setting.picbedConfigured} type="password" autoComplete="new-password" maxLength={10000} value={token} onChange={(event) => setToken(event.target.value)} placeholder={setting.picbedConfigured ? `留空保留已加密令牌 ${setting.tokenHint}` : "输入图床访问令牌"} /></label>
        <label className="storage-settings-toggle"><input disabled={Boolean(pending)} type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>启用这套外部图床配置</span></label>
        <p className="ai-security-note">端点必须使用公开 HTTPS 地址。令牌只在服务端加密保存，不会返回浏览器或写入代码仓库。</p>
      </div>}
      <div className="storage-settings-actions">
        <button className="primary-action" disabled={Boolean(pending)} aria-busy={pending === "save"} type="submit">{pending === "save" ? "正在保存存储设置…" : "保存存储设置"}</button>
        <button disabled={Boolean(pending) || dirty || setting.providerType === "picbed" && !setting.enabled} aria-busy={pending === "test"} type="button" onClick={() => void testConnection()}>{pending === "test" ? "正在测试存储…" : "测试当前存储"}</button>
        {setting.picbedConfigured ? <button disabled={Boolean(pending)} aria-busy={pending === "remove"} className="danger-text" type="button" onClick={() => void remove()}>{pending === "remove" ? "正在删除连接…" : "删除外部图床配置"}</button> : null}
      </div>
      {dirty ? <p className="storage-pending-note">请先保存选择，再测试当前存储。</p> : null}
      {message ? <p className="ai-message ai-message--success" role="status">{message}</p> : null}
      {error ? <p className="ai-message ai-message--error" role="alert">{error}</p> : null}
    </form>
    <aside className="storage-settings-card storage-settings-help">
      <span className="section-kicker">YOUR IMAGES / YOUR CHOICE</span><h3>两种方式，独立配置</h3>
      <h4>站点本地存储</h4><p>无需额外图床或存储令牌。文件由应用控制访问，部署者负责磁盘空间、图片数据卷和数据库的配套备份；不要删除 Docker 数据卷。</p>
      <h4>外部图床兼容接口</h4><p>应用以 <code>multipart/form-data</code> 上传 <code>file</code> 与 <code>path</code>，并在 <code>X-Auth-Token</code> 请求头中发送令牌。</p><p>JSON 可包含 <code>url</code>、<code>publicUrl</code>、<code>href</code>、<code>location</code>、<code>key</code> 或 <code>path</code>。返回图片必须能通过公网 HTTPS 读取。</p>
      {setting.lastTestedAt ? <div className={`storage-test-result storage-test-result--${setting.lastTestStatus}`}><strong>{setting.lastTestStatus === "success" ? "最近测试成功" : "最近测试失败"}</strong><span>{setting.lastTestMessage}</span><small>{new Date(setting.lastTestedAt).toLocaleString("zh-CN")}</small></div> : null}
    </aside>
  </div>;
}
