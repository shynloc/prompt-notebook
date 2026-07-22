import { AppShell } from "@/components/app-shell/app-shell";
import { NoteGallery } from "@/components/notes/note-gallery";

export default function ArchivePage() {
  return <AppShell><NoteGallery view="archived" heading="归档" intro="暂时不用、但仍希望完整保留的提示词。" /></AppShell>;
}
