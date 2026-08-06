"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState } from "react";

import { NoteGallery } from "@/components/notes/note-gallery";
import { confirmPermanentCharacterDeletion } from "./permanent-delete-confirmation";
import {
  CHARACTER_VIEW_OPTIONS,
  characterApiMessage,
  type CharacterImage,
  type CharacterProfile,
} from "./types";

function viewLabel(value: CharacterImage["viewType"]) {
  return CHARACTER_VIEW_OPTIONS.find((option) => option.id === value)?.label ?? "其他";
}

export function CharacterProfileView({ initial }: { initial: CharacterProfile }) {
  const [profile, setProfile] = useState(initial);
  const [featured, setFeatured] = useState<CharacterImage | null>(initial.coverImage ?? initial.images[0] ?? null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [permanentlyDeleted, setPermanentlyDeleted] = useState(false);

  async function changeState(action: "archive" | "unarchive" | "trash" | "restore") {
    if (action === "trash" && !window.confirm(`将 AI Model“${profile.name}”移到回收站？关联提示词不会被删除。`)) return;
    setPending(true);
    setMessage(action === "restore" ? "正在恢复角色卡…" : "正在更新角色状态…");
    try {
      const restore = action === "restore";
      const trash = action === "trash";
      const response = await fetch(restore ? `/api/v1/ai-models/${profile.id}/restore` : `/api/v1/ai-models/${profile.id}`, {
        method: restore ? "POST" : trash ? "DELETE" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: profile.version,
          ...(!restore && !trash ? { archivedAt: action === "archive" ? new Date().toISOString() : null } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "角色状态更新失败，请刷新后重试。"));
        return;
      }
      setProfile(body.data);
      setMessage(action === "archive" ? "AI Model 已归档，不再出现在生图选择器中。" : action === "unarchive" ? "AI Model 已恢复使用。" : action === "trash" ? "AI Model 已移入回收站。" : "AI Model 已从回收站恢复。");
    } catch {
      setMessage("无法连接云端，角色状态没有改变。");
    } finally {
      setPending(false);
    }
  }

  async function copyAnchor() {
    try {
      await navigator.clipboard.writeText(profile.promptAnchor);
      setMessage("默认提示词片段已复制。");
    } catch {
      setMessage("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  async function permanentlyDelete() {
    const confirmation = confirmPermanentCharacterDeletion(profile.name);
    if (confirmation === "cancelled") return;
    if (confirmation === "mismatch") {
      setMessage("输入的角色名称不匹配，永久删除已取消，数据没有变化。");
      return;
    }

    setPending(true);
    setMessage(`正在永久删除“${profile.name}”…外部图床原文件不会自动删除。`);
    try {
      const response = await fetch(`/api/v1/ai-models/${profile.id}?mode=permanent`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: profile.version }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(characterApiMessage(body, "永久删除失败，角色数据仍然保留，请刷新后重试。"));
        return;
      }
      setPermanentlyDeleted(true);
    } catch {
      setMessage("无法连接云端，角色数据没有被永久删除，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }

  const deleted = Boolean(profile.deletedAt);
  const archived = Boolean(profile.archivedAt);
  const primary = profile.primaryImage ?? profile.images[0] ?? null;

  if (permanentlyDeleted) {
    return (
      <div className="character-library-state character-permanent-delete-success" role="status" aria-live="polite">
        <span>PERMANENTLY DELETED</span>
        <strong>“{profile.name}”已从 Prompt Notebook 永久删除</strong>
        <p>外部图床中的原始图片没有自动删除；如需清理，请前往图床服务管理。</p>
        <Link className="primary-action" href="/ai-models">返回 AI Model 资产库</Link>
      </div>
    );
  }

  return (
    <div className="character-profile-page">
      <header className="character-profile-hero">
        <div className="character-profile-hero__photo">
          {featured ? <img src={featured.displayUrl} alt={`${profile.name} ${featured.caption || viewLabel(featured.viewType)}`} style={{ objectPosition: `${featured.focusX}% ${featured.focusY}%` }} /> : <div className="character-placeholder"><span>M</span><small>NO PORTRAIT</small></div>}
          <span>AI MODEL / {profile.id.slice(0, 8).toUpperCase()}</span>
        </div>
        <div className="character-profile-hero__copy">
          <div><span className="section-kicker">CASTING FILE / CHARACTER ASSET</span><span className="character-profile-status">{deleted ? "回收站" : archived ? "已归档" : "可使用"}</span></div>
          <h2>{profile.name}</h2>
          <p>{profile.summary || "这张角色卡还没有填写一句话定位。"}</p>
          <div className="character-use-cases">{profile.useCases.map((item) => <span key={item}>{item}</span>)}</div>
          <dl className="character-profile-stats"><div><dt>参考图</dt><dd>{profile.images.length}</dd></div><div><dt>绑定提示词</dt><dd>{profile.noteCount}</dd></div><div><dt>生成任务</dt><dd>{profile.generationCount}</dd></div><div><dt>版本</dt><dd>V{profile.version}</dd></div></dl>
          <div className="character-profile-actions">
            {!deleted ? <Link className="primary-action" href={`/imagehub?character=${profile.id}`}>在 AI ImageHub 使用</Link> : null}
            {!deleted ? <Link href={`/notes/new?character=${profile.id}`}>新建关联提示词</Link> : null}
            {!deleted ? <Link href={`/ai-models/${profile.id}/edit`}>编辑角色卡</Link> : null}
            {!deleted && !archived ? <button disabled={pending} type="button" onClick={() => void changeState("archive")}>{pending ? "处理中…" : "归档"}</button> : null}
            {!deleted && archived ? <button disabled={pending} type="button" onClick={() => void changeState("unarchive")}>{pending ? "处理中…" : "移出归档"}</button> : null}
            {!deleted ? <button className="danger-action" disabled={pending} type="button" onClick={() => void changeState("trash")}>{pending ? "处理中…" : "移到回收站"}</button> : <button className="primary-action" disabled={pending} type="button" onClick={() => void changeState("restore")}>{pending ? "恢复中…" : "恢复 AI Model"}</button>}
            {deleted ? <button className="danger-action" disabled={pending} type="button" onClick={() => void permanentlyDelete()}>{pending ? "永久删除中…" : "永久删除"}</button> : null}
          </div>
          {deleted ? <p className="character-danger-note">永久删除只会清除笔记本内的角色数据；外部图床原文件不会自动删除。</p> : null}
          {message ? <p className="character-feedback" role="status" aria-live="polite">{message}</p> : null}
        </div>
      </header>

      <div className="character-profile-content">
        <main className="character-profile-copy">
          <section><span className="section-kicker">ROLE DEFINITION</span><h3>角色设定</h3><p>{profile.roleDefinition}</p></section>
          {profile.appearance ? <section><span className="section-kicker">APPEARANCE ANCHOR</span><h3>外观锚点</h3><p>{profile.appearance}</p></section> : null}
          {profile.promptAnchor ? <section><div className="character-section-heading"><div><span className="section-kicker">PROMPT ANCHOR</span><h3>默认提示词片段</h3></div><button type="button" onClick={() => void copyAnchor()}>复制</button></div><pre>{profile.promptAnchor}</pre></section> : null}
          {profile.negativePrompt ? <section><span className="section-kicker">NEGATIVE ANCHOR</span><h3>默认负面约束</h3><pre>{profile.negativePrompt}</pre></section> : null}
          {profile.rightsNote ? <details className="character-rights character-rights--profile"><summary>来源与授权备注（仅自己可见）</summary><p>{profile.rightsNote}</p></details> : null}
        </main>

        <aside className="character-primary-card">
          <span className="section-kicker">PRIMARY REFERENCE</span>
          <h3>默认主参考图</h3>
          {primary ? <button type="button" onClick={() => setFeatured(primary)}><img src={primary.thumbnailUrl} alt={`${profile.name} 默认主参考图`} /><span>{viewLabel(primary.viewType)}{primary.caption ? ` · ${primary.caption}` : ""}</span></button> : <div className="character-placeholder"><span>M</span><small>PRIMARY PENDING</small></div>}
          <p>进入 ImageHub 选择此角色时，主图会作为默认推荐。</p>
        </aside>
      </div>

      <section className="character-contact-sheet" aria-labelledby="character-contact-sheet-title">
        <header className="character-section-heading"><div><span className="section-kicker">CONTACT SHEET</span><h3 id="character-contact-sheet-title">角色参考图档案</h3><p>点击图片可在上方查看大图；封面和主图拥有独立用途。</p></div><strong>{profile.images.length} 张</strong></header>
        {profile.images.length ? <div className="character-contact-sheet__grid">{profile.images.map((image, index) => <button aria-pressed={featured?.id === image.id} key={image.id} type="button" onClick={() => setFeatured(image)}><img src={image.thumbnailUrl} loading="lazy" alt={`${profile.name} 参考图 ${index + 1}`} /><span><strong>{String(index + 1).padStart(2, "0")} · {viewLabel(image.viewType)}</strong><small>{image.isCover ? "封面 " : ""}{image.isPrimary ? "主图" : ""}{image.caption}</small></span></button>)}</div> : <div className="character-library-state"><strong>还没有角色参考图</strong><p>编辑角色卡即可上传主图和多视角备用图。</p></div>}
      </section>

      {!deleted ? <section className="character-linked-notes"><NoteGallery characterProfileId={profile.id} heading={`与 ${profile.name} 绑定的提示词`} intro={`查看所有使用“${profile.name}”的提示词笔记和生成作品。`} /></section> : <div className="character-library-state"><strong>回收站中的角色不显示提示词瀑布流</strong><p>恢复角色后即可继续查看原有绑定关系。</p></div>}
    </div>
  );
}

export function CharacterProfileLoader({ id }: { id: string }) {
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "error">("loading");

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/ai-models/${id}?includeDeleted=true`, { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (response.status === 401) { window.location.assign(`/sign-in?returnTo=${encodeURIComponent(`/ai-models/${id}`)}`); return; }
      if (response.status === 404) { setState("missing"); return; }
      if (!response.ok) { setState("error"); return; }
      setProfile((await response.json()).data);
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [id]);

  if (profile) return <CharacterProfileView initial={profile} />;
  if (state === "missing") return <div className="gallery-state">找不到这个 AI Model，或你无权查看。<br /><Link href="/ai-models">返回资产库</Link></div>;
  if (state === "error") return <div className="gallery-state">暂时无法读取角色 Profile。<br /><button type="button" onClick={() => window.location.reload()}>重新载入</button></div>;
  return <div className="gallery-state" role="status">正在打开 AI Model Profile…</div>;
}
