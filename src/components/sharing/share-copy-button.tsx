"use client";

import { useState } from "react";

export function ShareCopyButton({ prompt }: { prompt: string }) { const [copied, setCopied] = useState(false); return <button type="button" onClick={async () => { await navigator.clipboard.writeText(prompt); setCopied(true); }}>{copied ? "已复制" : "复制完整提示词"}</button>; }
