import { AppShell } from "@/components/app-shell/app-shell";
import { TagCollection } from "@/components/tags/tag-collection";

export default async function TagPage({ params }: { params: Promise<{ id: string }> }) { return <AppShell><TagCollection id={(await params).id} /></AppShell>; }
