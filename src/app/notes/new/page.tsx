import { AppShell } from "@/components/app-shell/app-shell";
import { DuplicateNoteLoader } from "@/components/editor/duplicate-note-loader";

export default async function NewNotePage({ searchParams }: { searchParams: Promise<{ duplicate?: string; character?: string }> }) {
  const query = await searchParams;
  return <AppShell><DuplicateNoteLoader id={query.duplicate} characterId={query.character} /></AppShell>;
}
