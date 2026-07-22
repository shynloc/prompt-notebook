"use client";

import { useEffect, useState } from "react";
import type { NoteView } from "@/components/notes/types";
import { PromptEditor } from "./prompt-editor";

export function DuplicateNoteLoader({ id }: { id?: string }) {
  const [seed, setSeed] = useState<NoteView | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { if (!id) return; let active = true; void fetch(`/api/v1/notes/${id}`).then(async (response) => { if (!active) return; if (!response.ok) { setMissing(true); return; } const note = (await response.json()).data as NoteView; setSeed({ ...note, title: `${note.title} 副本`, id: "", version: 1 }); }); return () => { active = false; }; }, [id]);
  if (!id) return <PromptEditor />;
  if (missing) return <PromptEditor />;
  if (!seed) return <div className="gallery-state">正在准备副本…</div>;
  return <PromptEditor seed={seed} />;
}
