"use client";

import { useState } from "react";

export function BulkToolbar({ ids, onDone, onClear }: { ids: string[]; onDone: () => void; onClear: () => void }) {
  const [pending, setPending] = useState(false);
  async function apply(action: string) { setPending(true); const response = await fetch("/api/v1/notes/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) }); setPending(false); if (response.ok) { onClear(); onDone(); } else window.alert("批量操作失败，请刷新后重试。"); }
  if (!ids.length) return null;
  return <div className="bulk-toolbar" role="toolbar" aria-label="批量管理"><strong>已选择 {ids.length} 条</strong><button disabled={pending} type="button" onClick={() => void apply("favorite")}>收藏</button><button disabled={pending} type="button" onClick={() => void apply("archive")}>归档</button><button className="danger-action" disabled={pending} type="button" onClick={() => window.confirm(`把 ${ids.length} 条笔记移到回收站？`) && void apply("delete")}>删除</button><button disabled={pending} type="button" onClick={onClear}>取消选择</button></div>;
}
