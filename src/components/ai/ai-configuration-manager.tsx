"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Capability = "prompt_optimization" | "image_generation" | "reverse_prompt";
type Purpose = Capability;

interface AiConfiguration {
  id: string;
  name: string;
  providerType: "openai_compatible";
  baseUrl: string;
  secretHint: string;
  enabled: boolean;
  lastTestStatus: "success" | "failed" | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  modelProfileId: string;
  modelId: string;
  displayName: string;
  capabilities: Capability[];
  defaultParameters: Record<string, string | number | boolean>;
  modelEnabled: boolean;
}

interface Preference { purpose: Purpose; modelProfileId: string }

const capabilityOptions: Array<{ id: Capability; label: string }> = [
  { id: "prompt_optimization", label: "提示词优化" },
  { id: "image_generation", label: "图片生成" },
  { id: "reverse_prompt", label: "图片反推" },
];

const purposeLabels: Record<Purpose, string> = {
  prompt_optimization: "提示词优化模型",
  image_generation: "图片生成模型",
  reverse_prompt: "图片反推模型",
};

function emptyForm() {
  return {
    name: "",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelId: "",
    displayName: "",
    capabilities: ["prompt_optimization"] as Capability[],
  };
}

function responseMessage(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
  const error = (body as { error?: unknown }).error;
  return typeof error === "object" && error !== null && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : fallback;
}

export function AiConfigurationManager() {
  const [configurations, setConfigurations] = useState<AiConfiguration[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [configResponse, preferenceResponse] = await Promise.all([
      fetch("/api/v1/ai/configurations"),
      fetch("/api/v1/ai/preferences"),
    ]);
    if (configResponse.status === 401 || preferenceResponse.status === 401) {
      window.location.assign("/sign-in?returnTo=/settings/ai");
      return;
    }
    if (!configResponse.ok || !preferenceResponse.ok) throw new Error("AI 配置加载失败，请稍后重试。");
    setConfigurations((await configResponse.json()).data);
    setPreferences((await preferenceResponse.json()).data);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/v1/ai/configurations"),
      fetch("/api/v1/ai/preferences"),
    ]).then(async ([configResponse, preferenceResponse]) => {
      if (!active) return;
      if (configResponse.status === 401 || preferenceResponse.status === 401) {
        window.location.assign("/sign-in?returnTo=/settings/ai");
        return;
      }
      if (!configResponse.ok || !preferenceResponse.ok) throw new Error();
      setConfigurations((await configResponse.json()).data);
      setPreferences((await preferenceResponse.json()).data);
    }).catch(() => { if (active) setError("AI 配置加载失败，请稍后重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const preferenceMap = useMemo(
    () => new Map(preferences.map((preference) => [preference.purpose, preference.modelProfileId])),
    [preferences],
  );

  function toggleCapability(capability: Capability) {
    setForm((current) => {
      const exists = current.capabilities.includes(capability);
      if (exists && current.capabilities.length === 1) return current;
      return {
        ...current,
        capabilities: exists
          ? current.capabilities.filter((value) => value !== capability)
          : [...current.capabilities, capability],
      };
    });
  }

  function edit(configuration: AiConfiguration) {
    setEditingId(configuration.id);
    setForm({
      name: configuration.name,
      baseUrl: configuration.baseUrl,
      apiKey: "",
      modelId: configuration.modelId,
      displayName: configuration.displayName,
      capabilities: configuration.capabilities,
    });
    setMessage("");
    setError("");
    const editor = document.getElementById("ai-configuration-form");
    if (typeof editor?.scrollIntoView === "function") {
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    const payload = {
      name: form.name,
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      displayName: form.displayName || form.modelId,
      capabilities: form.capabilities,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      ...(!editingId ? { providerType: "openai_compatible", enabled: true } : {}),
    };
    if (!editingId && !form.apiKey) {
      setError("新建配置时必须填写 API Key。");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch(
        editingId ? `/api/v1/ai/configurations/${editingId}` : "/api/v1/ai/configurations",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(responseMessage(body, "配置保存失败。"));
      setMessage(editingId ? "配置已更新，未填写的新 API Key 不会改变原密钥。" : "配置已加密保存。");
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(configuration: AiConfiguration) {
    setTestingId(configuration.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/v1/ai/configurations/${configuration.id}/test`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(responseMessage(body, "连接测试失败。"));
      setMessage(`“${configuration.name}”连接成功，发现 ${body.data.availableModelIds.length} 个模型。`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接测试失败。");
      await load().catch(() => undefined);
    } finally {
      setTestingId(null);
    }
  }

  async function toggleEnabled(configuration: AiConfiguration) {
    setError("");
    const response = await fetch(`/api/v1/ai/configurations/${configuration.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !configuration.enabled }),
    });
    const body = await response.json();
    if (!response.ok) { setError(responseMessage(body, "状态更新失败。")); return; }
    setMessage(configuration.enabled ? "配置已停用。" : "配置已启用。");
    await load();
  }

  async function remove(configuration: AiConfiguration) {
    if (!window.confirm(`删除 AI 配置“${configuration.name}”？已保存的 API Key 也会一并删除。`)) return;
    setError("");
    const response = await fetch(`/api/v1/ai/configurations/${configuration.id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(responseMessage(body, "配置删除失败。")); return; }
    if (editingId === configuration.id) resetForm();
    setMessage("配置及其默认用途已删除。");
    await load();
  }

  async function setPurpose(purpose: Purpose, modelProfileId: string | null) {
    setError("");
    const response = await fetch("/api/v1/ai/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose, modelProfileId }),
    });
    const body = await response.json();
    if (!response.ok) { setError(responseMessage(body, "默认模型更新失败。")); return; }
    setPreferences((current) => [
      ...current.filter((preference) => preference.purpose !== purpose),
      ...(modelProfileId ? [{ purpose, modelProfileId }] : []),
    ]);
    setMessage(`${purposeLabels[purpose]}已更新。`);
  }

  if (loading) return <div className="ai-settings-loading" role="status">正在加载 AI 配置…</div>;

  return (
    <div className="ai-settings-layout">
      <section className="ai-purpose-panel" aria-labelledby="ai-purpose-title">
        <div>
          <span className="section-kicker">ACTIVE MODELS</span>
          <h3 id="ai-purpose-title">当前使用的模型</h3>
          <p>三个用途可以使用不同配置；停用或删除配置后，需要重新选择。</p>
        </div>
        <div className="ai-purpose-grid">
          {capabilityOptions.map(({ id, label }) => {
            const eligible = configurations.filter((configuration) => configuration.enabled
              && configuration.modelEnabled
              && configuration.capabilities.includes(id));
            return (
              <label key={id}>
                <span>{label}</span>
                <select
                  aria-label={purposeLabels[id]}
                  value={preferenceMap.get(id) ?? ""}
                  onChange={(event) => void setPurpose(id, event.target.value || null)}
                >
                  <option value="">尚未指定</option>
                  {eligible.map((configuration) => (
                    <option key={configuration.modelProfileId} value={configuration.modelProfileId}>
                      {configuration.name} · {configuration.displayName}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </section>

      <div className="ai-settings-columns">
        <form id="ai-configuration-form" className="ai-configuration-form" onSubmit={submit}>
          <div className="ai-panel-heading">
            <div><span className="section-kicker">{editingId ? "EDIT" : "ADD"}</span><h3>{editingId ? "编辑配置" : "新增模型配置"}</h3></div>
            {editingId ? <button type="button" onClick={resetForm}>退出编辑</button> : null}
          </div>
          <label>配置名称<input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：主要提示词助手" /></label>
          <label>接口类型<select value="openai_compatible" disabled><option value="openai_compatible">OpenAI-compatible</option></select></label>
          <label>Base URL<input required type="url" maxLength={2048} value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
          <label>API Key<input required={!editingId} type="password" autoComplete="new-password" maxLength={10000} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingId ? "留空则保持已加密的原密钥" : "sk-…"} /></label>
          <div className="ai-form-grid">
            <label>Model ID<input required maxLength={200} value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} placeholder="例如：gpt-5-mini" /></label>
            <label>显示名称<input maxLength={120} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="留空则使用 Model ID" /></label>
          </div>
          <fieldset>
            <legend>模型能力</legend>
            <div className="ai-capability-picker">
              {capabilityOptions.map(({ id, label }) => (
                <label key={id}>
                  <input type="checkbox" checked={form.capabilities.includes(id)} onChange={() => toggleCapability(id)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="ai-security-note">API Key 会在服务端加密保存，保存后不会再次显示完整内容。</p>
          <button className="primary-action" type="submit" disabled={saving}>{saving ? "正在保存…" : editingId ? "保存修改" : "加密保存配置"}</button>
        </form>

        <section className="ai-configuration-list" aria-labelledby="ai-configurations-title">
          <div className="ai-panel-heading"><div><span className="section-kicker">SAVED</span><h3 id="ai-configurations-title">已保存配置</h3></div><span>{configurations.length} / 50</span></div>
          {message ? <p className="ai-message ai-message--success" role="status">{message}</p> : null}
          {error ? <p className="ai-message ai-message--error" role="alert">{error}</p> : null}
          {!configurations.length ? <div className="ai-empty-state"><strong>还没有 AI 配置</strong><p>先添加一套 OpenAI-compatible 模型连接，然后指定它的用途。</p></div> : null}
          <div className="ai-configuration-cards">
            {configurations.map((configuration) => (
              <article className={`ai-configuration-card${configuration.enabled ? "" : " ai-configuration-card--disabled"}`} key={configuration.id}>
                <header><div><h4>{configuration.name}</h4><p>{configuration.displayName} <code>{configuration.modelId}</code></p></div><span className={configuration.enabled ? "ai-status ai-status--enabled" : "ai-status"}>{configuration.enabled ? "已启用" : "已停用"}</span></header>
                <dl><div><dt>接口</dt><dd>{configuration.baseUrl}</dd></div><div><dt>密钥</dt><dd>{configuration.secretHint} · 已加密</dd></div></dl>
                <div className="ai-capability-badges">{configuration.capabilities.map((capability) => <span key={capability}>{capabilityOptions.find((item) => item.id === capability)?.label}</span>)}</div>
                {configuration.lastTestedAt ? <p className={`ai-test-result ai-test-result--${configuration.lastTestStatus}`}>{configuration.lastTestMessage} · {new Date(configuration.lastTestedAt).toLocaleString("zh-CN")}</p> : <p className="ai-test-result">尚未测试连接</p>}
                <footer>
                  <button type="button" disabled={testingId === configuration.id || !configuration.enabled} onClick={() => void testConnection(configuration)}>{testingId === configuration.id ? "测试中…" : "测试连接"}</button>
                  <button type="button" onClick={() => edit(configuration)}>编辑</button>
                  <button type="button" onClick={() => void toggleEnabled(configuration)}>{configuration.enabled ? "停用" : "启用"}</button>
                  <button className="danger-text" type="button" onClick={() => void remove(configuration)}>删除</button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
