import { Suspense } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { ImageHubWorkbench } from "@/components/imagehub/imagehub-workbench";

export default function ImageHubPage() {
  return <AppShell><Suspense fallback={<div className="imagehub-empty">正在打开 AI ImageHub…</div>}><ImageHubWorkbench /></Suspense></AppShell>;
}
