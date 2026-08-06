import { AppShell } from "@/components/app-shell/app-shell";
import { CharacterProfileLoader } from "@/components/characters/character-profile-view";

export default async function AiModelProfilePage({ params }: { params: Promise<{ id: string }> }) {
  return <AppShell><CharacterProfileLoader id={(await params).id} /></AppShell>;
}
