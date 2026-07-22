import { AppShell } from "@/components/app-shell/app-shell";
import { NoteGallery } from "@/components/notes/note-gallery";

export default function TrashPage() {
  return <AppShell><NoteGallery view="trash" heading="回收站" intro="误删的提示词可以在这里恢复；回收站内容不会出现在搜索和标签集合中。" /></AppShell>;
}
