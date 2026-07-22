import { AppShell } from "@/components/app-shell/app-shell";
import { DuplicateNoteLoader } from "@/components/editor/duplicate-note-loader";

export default async function NewNotePage({ searchParams }: { searchParams: Promise<{ duplicate?: string }> }) { return <AppShell><DuplicateNoteLoader id={(await searchParams).duplicate} /></AppShell>; }
