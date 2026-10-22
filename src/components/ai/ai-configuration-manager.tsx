"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getImageModelCapabilities } from "@/modules/ai/image-capabilities";

type Capability = "prompt_optimization" | "image_generation" | "reverse_prompt";
type Purpose = Capability | "term_analysis";

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
  term_analysis: "词库分析模型",
  image_generation: "图片生成模型",
  reverse_prompt: "图片反推模型",
};

const purposeOptions: Array<{ id: Purpose; label: string; capability: Capability }> = [
  { id: "prompt_optimization", label: "提示词优化", capability: "prompt_optimization" },
  { id: "term_analysis", label: "词库分析", capability: "prompt_optimization" },
  { id: "image_generation", label: "图片生成", capability: "image_generation" },
  { id: "reverse_prompt", label: "图片反推", capability: "reverse_prompt" },
];

function emptyForm() {
  return {
    name: "",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelId: "",
    displayName: "",
    capabilities: ["prompt_optimization"] as Capability[],
    defaultParameters: {} as Record<string, string | number | boolean>,
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
  const router = useRouter();
  const [configurations, setConfigurations] = useState<AiConfiguration[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const imageCapabilities = useMemo(() => {
    try { return getImageModelCapabilities(form.modelId, form.defaultParameters); }
    catch { return getImageModelCapabilities("unknown"); }
  }, [form.modelId, form.defaultParameters]);

  async function load() {
    const [configResponse, preferenceResponse] = await Promise.all([
      fetch("/api/v1/ai/configurations"),
      fetch("/api/v1/ai/preferences"),
    ]);
    if (configResponse.status === 401 || preferenceResponse.status === 401) {
      router.replace("/sign-in?returnTo=/settings/ai");
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
        router.replace("/sign-in?returnTo=/settings/ai");
        return;
      }
      if (!configResponse.ok || !preferenceResponse.ok) throw new Error();
      setConfigurations((await configResponse.json()).data);
      setPreferences((await preferenceResponse.json()).data);
    }).catch(() => { if (active) setError("AI 配置加载失败，请稍后重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

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
      defaultParameters: { ...configuration.defaultParameters },
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
      defaultParameters: form.defaultParameters,
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
      const availableModelIds = Array.isArray(body.data.availableModelIds) ? body.data.availableModelIds : [];
      const listed = availableModelIds.includes(configuration.modelId);
      setMessage(`“${configuration.name}”连接正常，${listed ? "所填模型已在模型列表中找到" : "模型列表未包含所填型号，请核对供应商说明"}。此测试未执行生图，具体参数支持以供应商实际接口为准。`);
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
          <p>各项用途可以使用不同配置；词库分析未单独指定时会继承提示词优化模型。</p>
        </div>
        <div className="ai-purpose-grid">
          {purposeOptions.map(({ id, label, capability }) => {
            const eligible = configurations.filter((configuration) => configuration.enabled
              && configuration.modelEnabled
              && configuration.capabilities.includes(capability));
            return (
              <label key={id}>
                <span>{label}</span>
                <select
                  aria-label={purposeLabels[id]}
                  value={preferenceMap.get(id) ?? ""}
                  onChange={(event) => void setPurpose(id, event.target.value || null)}
                >
                  <option value="">{id === "term_analysis" ? "继承提示词优化模型" : "尚未指定"}</option>
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
          {form.capabilities.includes("image_generation") ? <fieldset>
            <legend>生图兼容与默认输出</legend>
            <div className="ai-form-grid">
              <label>生图模型系列<select value={String(form.defaultParameters.imageModelFamily ?? "auto")} onChange={(event) => setForm((current) => {
                const parameters = { ...current.defaultParameters };
                if (event.target.value === "auto") delete parameters.imageModelFamily;
                else parameters.imageModelFamily = event.target.value;
                return { ...current, defaultParameters: parameters };
              })}>
                <option value="auto">自动识别 Model ID</option>
                <option value="gpt-image-2.5">GPT Image 2.5</option>
                <option value="gpt-image-2">GPT Image 2</option>
                <option value="gpt-image-1">GPT Image 1 / 1.5</option>
                <option value="dall-e-3">DALL·E 3</option>
                <option value="custom">自定义兼容模型（未验证）</option>
              </select></label>
              <label>默认图片格式<select value={String(form.defaultParameters.output_format ?? "jpeg")} onChange={(event) => setForm((current) => {
                const parameters: Record<string, string | number | boolean> = { ...current.defaultParameters, output_format: event.target.value };
                if (event.target.value === "png") delete parameters.output_compression;
                if (event.target.value === "jpeg" && parameters.background === "transparent") parameters.background = "opaque";
                return { ...current, defaultParameters: parameters };
              })}><option disabled={!imageCapabilities.formats.includes("png")} value="png">PNG</option><option disabled={!imageCapabilities.formats.includes("jpeg")} value="jpeg">JPEG</option><option disabled={!imageCapabilities.formats.includes("webp")} value="webp">WebP</option></select></label>
              <label>默认图片背景<select value={String(form.defaultParameters.background ?? "auto")} onChange={(event) => setForm((current) => ({ ...current, defaultParameters: { ...current.defaultParameters, background: event.target.value } }))}><option value="auto">自动</option><option disabled={!imageCapabilities.backgrounds.includes("opaque")} value="opaque">不透明</option><option disabled={!imageCapabilities.transparency || (form.defaultParameters.output_format ?? "jpeg") === "jpeg"} value="transparent">透明（PNG / WebP）</option></select></label>
              <label>默认压缩质量（0–100）<input disabled={!imageCapabilities.supportsCompression || form.defaultParameters.output_format === "png"} type="number" min={0} max={100} step={1} placeholder="留空由接口决定" value={typeof form.defaultParameters.output_compression === "number" ? form.defaultParameters.output_compression : ""} onChange={(event) => setForm((current) => {
                const parameters = { ...current.defaultParameters };
                if (event.target.value === "") delete parameters.output_compression;
                else parameters.output_compression = Number(event.target.value);
                return { ...current, defaultParameters: parameters };
              })} /></label>
            </div>
            <p className="ai-security-note">供应商使用自定义型号名称时，可指定兼容系列。该选择只决定可用参数，不会验证供应商实际能力；JPEG 不支持透明背景，压缩质量仅适用于 JPEG / WebP。</p>
          </fieldset> : null}
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
