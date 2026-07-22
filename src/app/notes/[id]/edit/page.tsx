import { AppShell } from "@/components/app-shell/app-shell";
import { EditNoteLoader } from "@/components/editor/edit-note-loader";

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  return <AppShell><EditNoteLoader id={(await params).id} /></AppShell>;
}
