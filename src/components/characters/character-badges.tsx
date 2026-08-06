/* eslint-disable @next/next/no-img-element */

import Link from "next/link";

import type { NoteCharacterProfile } from "@/components/notes/types";

const roleLabels: Record<NoteCharacterProfile["role"], string> = {
  primary: "主要角色",
  supporting: "辅助角色",
  reference: "参考角色",
};

export function CharacterBadges({
  profiles,
  compact = false,
  max = compact ? 3 : 8,
}: {
  profiles: NoteCharacterProfile[];
  compact?: boolean;
  max?: number;
}) {
  if (!profiles.length) return null;
  const shown = profiles.slice(0, max);
  return (
    <div className="character-badges" data-compact={compact} aria-label="关联 AI Model">
      {shown.map((profile) => <Link aria-label={`${roleLabels[profile.role]} AI Model：${profile.name}`} data-archived={Boolean(profile.archivedAt)} href={`/ai-models/${profile.id}`} key={profile.id}>
        <span className="character-badges__avatar">{profile.avatar ? <img alt="" loading="lazy" src={profile.avatar.thumbnailUrl} style={{ objectPosition: `${profile.avatar.focusX}% ${profile.avatar.focusY}%` }} /> : <b aria-hidden="true">M</b>}</span>
        <span><strong>{profile.name}</strong>{compact ? null : <small>{roleLabels[profile.role]}{profile.archivedAt ? " · 已归档" : ""}</small>}</span>
      </Link>)}
      {profiles.length > shown.length ? <span className="character-badges__more">+{profiles.length - shown.length}</span> : null}
    </div>
  );
}
