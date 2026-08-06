/* eslint-disable @next/next/no-img-element */

import Link from "next/link";

import type { CharacterLibraryView, CharacterProfile } from "./types";

export function CharacterCard({
  profile,
  view,
  pending = false,
  onArchive,
  onTrash,
  onRestore,
  onPermanentDelete,
}: {
  profile: CharacterProfile;
  view: CharacterLibraryView;
  pending?: boolean;
  onArchive: (profile: CharacterProfile, archived: boolean) => void;
  onTrash: (profile: CharacterProfile) => void;
  onRestore: (profile: CharacterProfile) => void;
  onPermanentDelete: (profile: CharacterProfile) => void;
}) {
  const cover = profile.coverImage ?? profile.images[0] ?? null;
  return (
    <article className="character-card" data-state={view}>
      <Link className="character-card__visual" href={`/ai-models/${profile.id}`} aria-label={`查看 AI Model ${profile.name}`}>
        {cover ? <img src={cover.thumbnailUrl} alt={`${profile.name} 角色封面`} loading="lazy" style={{ objectPosition: `${cover.focusX}% ${cover.focusY}%` }} /> : <div className="character-placeholder"><span>M</span><small>NO PORTRAIT</small></div>}
        <span className="character-card__serial">MODEL / {profile.id.slice(0, 8).toUpperCase()}</span>
        <span className="character-card__status">{view === "archived" ? "已归档" : view === "trash" ? "回收站" : "可使用"}</span>
      </Link>
      <div className="character-card__body">
        <header><div><small>AI MODEL PROFILE</small><h3><Link href={`/ai-models/${profile.id}`}>{profile.name}</Link></h3></div><span>{profile.images.length} IMG</span></header>
        <p>{profile.summary || profile.roleDefinition}</p>
        <div className="character-use-cases">{profile.useCases.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{profile.useCases.length > 4 ? <span>+{profile.useCases.length - 4}</span> : null}</div>
        <dl><div><dt>提示词</dt><dd>{profile.noteCount}</dd></div><div><dt>生成</dt><dd>{profile.generationCount}</dd></div><div><dt>更新</dt><dd>{new Date(profile.updatedAt).toLocaleDateString("zh-CN")}</dd></div></dl>
      </div>
      <footer className="character-card__actions">
        <Link href={`/ai-models/${profile.id}`}>查看</Link>
        {view !== "trash" ? <Link href={`/ai-models/${profile.id}/edit`}>编辑</Link> : null}
        {view === "active" ? <Link href={`/imagehub?character=${profile.id}`}>生图</Link> : null}
        {view === "active" ? <button disabled={pending} type="button" onClick={() => onArchive(profile, true)}>{pending ? "归档中…" : "归档"}</button> : null}
        {view === "archived" ? <button disabled={pending} type="button" onClick={() => onArchive(profile, false)}>{pending ? "恢复中…" : "移出归档"}</button> : null}
        {view !== "trash" ? <button className="danger-action" disabled={pending} type="button" onClick={() => onTrash(profile)}>回收</button> : null}
        {view === "trash" ? <button disabled={pending} type="button" onClick={() => onRestore(profile)}>{pending ? "恢复中…" : "恢复"}</button> : null}
        {view === "trash" ? <button className="danger-action" disabled={pending} type="button" onClick={() => onPermanentDelete(profile)}>{pending ? "永久删除中…" : "永久删除"}</button> : null}
      </footer>
    </article>
  );
}
