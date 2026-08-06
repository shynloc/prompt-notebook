"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import { CharacterImageManager } from "./character-image-manager";
import {
  characterApiMessage,
  imageInput,
  type CharacterImageDraft,
  type CharacterProfile,
} from "./types";

export function CharacterEditor({ initial }: { initial?: CharacterProfile }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [roleDefinition, setRoleDefinition] = useState(initial?.roleDefinition ?? "");
  const [appearance, setAppearance] = useState(initial?.appearance ?? "");
  const [promptAnchor, setPromptAnchor] = useState(initial?.promptAnchor ?? "");
  const [negativePrompt, setNegativePrompt] = useState(initial?.negativePrompt ?? "");
  const [rightsNote, setRightsNote] = useState(initial?.rightsNote ?? "");
  const [useCases, setUseCases] = useState(initial?.useCases ?? []);
  const [useCaseDraft, setUseCaseDraft] = useState("");
  const [images, setImages] = useState<CharacterImageDraft[]>(initial?.images ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const cover = images.find((image) => image.isCover) ?? images[0] ?? null;
  const primary = images.find((image) => image.isPrimary) ?? images[0] ?? null;

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty && !saving) event.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, saving]);

  function addUseCase(value = useCaseDraft) {
    const normalized = value.trim().normalize("NFKC");
    if (normalized && useCases.length < 12 && !useCases.some((item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
      setUseCases([...useCases, normalized]);
      setDirty(true);
    }
    setUseCaseDraft("");
  }

  function useCaseKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ","].includes(event.key)) {
      event.preventDefault();
      addUseCase();
    }
    if (event.key === "Backspace" && !useCaseDraft && useCases.length) {
      setUseCases(useCases.slice(0, -1));
      setDirty(true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !roleDefinition.trim()) {
      setMessage("请填写 AI Model 名称和角色设定。");
      return;
    }
    setSaving(true);
    setMessage("");
    const payload = {
      name,
      summary,
      roleDefinition,
      useCases,
      appearance,
      promptAnchor,
      negativePrompt,
      rightsNote,
      attributes: initial?.attributes ?? {},
      images: images.map(imageInput),
      ...(initial ? { version: initial.version } : {}),
    };
    try {
      const response = await fetch(initial ? `/api/v1/ai-models/${initial.id}` : "/api/v1/ai-models", {
        method: initial ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 401) {
        window.location.assign(`/sign-in?returnTo=${encodeURIComponent(initial ? `/ai-models/${initial.id}/edit` : "/ai-models/new")}`);
        return;
      }
      if (!response.ok) {
        setMessage(response.status === 409
          ? "这张角色卡已在其他设备修改。当前内容仍保留，请刷新比较后再保存。"
          : characterApiMessage(body, "角色卡保存失败，请稍后重试。"));
        return;
      }
      const saved = body.data as CharacterProfile;
      setDirty(false);
      setMessage("角色卡已保存，正在打开 Profile…");
      router.push(`/ai-models/${saved.id}`);
      router.refresh();
    } catch {
      setMessage("无法连接云端，当前输入仍保留在页面中，请恢复网络后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="character-editor-page">
      <header className="character-page-heading">
        <div><span className="section-kicker">{initial ? "EDIT CASTING FILE" : "NEW CASTING FILE"}</span><h2>{initial ? "编辑 AI Model" : "创建 AI Model"}</h2><p>建立可重复使用的角色档案、视觉锚点和生图参考资产。</p></div>
        <span className={dirty ? "character-save-state character-save-state--dirty" : "character-save-state"}>{saving ? "正在保存到云端" : dirty ? "有未保存修改" : initial ? "云端内容已同步" : "尚未保存"}</span>
      </header>

      <div className="character-editor-layout">
        <form className="character-editor" onSubmit={submit} onChange={() => setDirty(true)}>
          <section className="character-form-section" aria-labelledby="character-identity-title">
            <div className="character-section-heading"><div><span className="section-kicker">01 / IDENTITY</span><h3 id="character-identity-title">角色身份</h3><p>这些内容会成为角色卡片和检索入口。</p></div></div>
            <label className="field"><span>名称</span><input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Luna · 都市时装模特" /></label>
            <label className="field"><span>一句话定位</span><textarea aria-label="一句话定位" className="character-field--compact" maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="简要说明角色气质、身份与主要用途" /><small>{summary.length} / 500</small></label>
            <label className="field"><span>角色设定</span><textarea aria-label="角色设定" required maxLength={5_000} value={roleDefinition} onChange={(event) => setRoleDefinition(event.target.value)} placeholder="身份、性格、职业、背景、气质与不可改变的角色特征…" /><small>{roleDefinition.length.toLocaleString()} / 5,000</small></label>
            <div className="field"><span>用途方向</span><div className="character-token-input">{useCases.map((useCase) => <button key={useCase} type="button" onClick={() => { setUseCases(useCases.filter((item) => item !== useCase)); setDirty(true); }}>{useCase}<span aria-hidden="true">×</span></button>)}<input aria-label="用途方向" disabled={useCases.length >= 12} maxLength={40} value={useCaseDraft} onChange={(event) => setUseCaseDraft(event.target.value)} onKeyDown={useCaseKeyDown} onBlur={() => useCaseDraft && addUseCase()} placeholder={useCases.length ? "继续添加…" : "电商、时尚、广告…按回车添加"} /></div><small>最多 12 项；点击已添加项目可移除。</small></div>
          </section>

          <section className="character-form-section" aria-labelledby="character-anchor-title">
            <div className="character-section-heading"><div><span className="section-kicker">02 / CONSISTENCY</span><h3 id="character-anchor-title">一致性锚点</h3><p>帮助写提示词和选择参考图，不会自动覆盖你的 Prompt。</p></div></div>
            <label className="field"><span>外观锚点</span><textarea aria-label="外观锚点" maxLength={5_000} value={appearance} onChange={(event) => setAppearance(event.target.value)} placeholder="发型、发色、五官、身形、年龄感、常用服装与其他稳定特征…" /></label>
            <label className="field"><span>默认提示词片段</span><textarea aria-label="默认提示词片段" className="character-field--medium" maxLength={10_000} value={promptAnchor} onChange={(event) => setPromptAnchor(event.target.value)} placeholder="每次使用这个角色时常用的正向描述…" /></label>
            <label className="field"><span>默认负面约束</span><textarea aria-label="默认负面约束" className="character-field--compact" maxLength={5_000} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="例如：不要改变发色、年龄与面部比例…" /></label>
            <details className="character-rights"><summary>来源与授权备注（私密）</summary><label className="field"><span className="sr-only">来源与授权备注</span><textarea className="character-field--compact" maxLength={2_000} value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} placeholder="记录素材来源、肖像授权或内部使用限制；不会出现在公开分享中。" /></label></details>
          </section>

          <CharacterImageManager images={images} onChange={(next) => { setImages(next); setDirty(true); }} />

          {message ? <p className="character-form-message" role={message.includes("已保存") ? "status" : "alert"}>{message}</p> : null}
          <footer className="character-editor-actions"><button className="primary-action" disabled={saving} type="submit">{saving ? "正在保存…" : initial ? "保存角色卡" : "创建 AI Model"}</button><Link href={initial ? `/ai-models/${initial.id}` : "/ai-models"}>取消</Link><span>图片保存在你配置的图床，应用服务器只记录引用。</span></footer>
        </form>

        <aside className="character-live-card" aria-label="角色卡实时预览">
          <span className="character-live-card__stamp">AI MODEL PROFILE</span>
          <div className="character-live-card__photo">{cover ? <img src={cover.thumbnailUrl} alt="角色封面预览" style={{ objectPosition: `${cover.focusX}% ${cover.focusY}%` }} /> : <div className="character-placeholder"><span>M</span><small>PORTRAIT PENDING</small></div>}<span className="character-live-card__serial">{initial ? initial.id.slice(0, 8).toUpperCase() : "NEW / UNSAVED"}</span></div>
          <div className="character-live-card__copy"><small>CASTING FILE</small><h3>{name.trim() || "未命名 AI Model"}</h3><p>{summary.trim() || "填写一句话定位后，它会显示在角色卡上。"}</p><div>{useCases.length ? useCases.map((item) => <span key={item}>{item}</span>) : <span>用途待设定</span>}</div><dl><div><dt>参考图</dt><dd>{images.length}</dd></div><div><dt>主图</dt><dd>{primary ? "READY" : "—"}</dd></div></dl></div>
        </aside>
      </div>
    </div>
  );
}

export function CharacterEditorLoader({ id }: { id: string }) {
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "error">("loading");

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/ai-models/${id}`, { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (response.status === 401) { window.location.assign(`/sign-in?returnTo=${encodeURIComponent(`/ai-models/${id}/edit`)}`); return; }
      if (response.status === 404) { setState("missing"); return; }
      if (!response.ok) { setState("error"); return; }
      setProfile((await response.json()).data);
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [id]);

  if (profile) return <CharacterEditor initial={profile} />;
  if (state === "missing") return <div className="gallery-state">找不到这个 AI Model，或它已在回收站中。<br /><Link href="/ai-models">返回资产库</Link></div>;
  if (state === "error") return <div className="gallery-state">暂时无法读取角色卡。<br /><button type="button" onClick={() => window.location.reload()}>重新载入</button></div>;
  return <div className="gallery-state" role="status">正在读取 AI Model 角色卡…</div>;
}
