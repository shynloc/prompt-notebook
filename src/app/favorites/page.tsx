import { AppShell } from "@/components/app-shell/app-shell";
import { NoteGallery } from "@/components/notes/note-gallery";

export default function FavoritesPage() {
  return <AppShell><NoteGallery view="favorites" heading="收藏" intro="把最常用、最值得反复调整的提示词集中在这里。" /></AppShell>;
}
