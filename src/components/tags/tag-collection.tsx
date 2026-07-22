"use client";

import { useEffect, useState } from "react";
import { NoteGallery } from "@/components/notes/note-gallery";

export function TagCollection({ id }: { id: string }) {
  const [name, setName] = useState("标签提示词");
  useEffect(() => { void fetch("/api/v1/tags").then((response) => response.ok ? response.json() : null).then((body) => { const tag = body?.data.find((item: { id: string }) => item.id === id); if (tag) setName(tag.name); }); }, [id]);
  return <NoteGallery tagId={id} heading={`# ${name}`} intro={`查看所有标记为“${name}”的提示词作品。`} />;
}
