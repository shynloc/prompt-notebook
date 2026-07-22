"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NoteView } from "@/components/notes/types";
import { PromptEditor } from "./prompt-editor";

export function EditNoteLoader({ id }: { id: string }) {
  const [note, setNote] = useState<NoteView | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { void fetch(`/api/v1/notes/${id}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) { setMissing(true); return; } setNote((await response.json()).data); }); }, [id]);
  if (missing) return <div className="gallery-state">找不到这条提示词，或你无权访问。<br /><Link href="/notes">返回作品库</Link></div>;
  if (!note) return <div className="gallery-state">正在读取提示词…</div>;
  return <PromptEditor initial={note} />;
}
