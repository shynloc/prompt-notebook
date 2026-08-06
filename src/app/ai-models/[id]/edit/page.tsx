import { AppShell } from "@/components/app-shell/app-shell";
import { CharacterEditorLoader } from "@/components/characters/character-editor";

export default async function EditAiModelPage({ params }: { params: Promise<{ id: string }> }) {
  return <AppShell><CharacterEditorLoader id={(await params).id} /></AppShell>;
}
