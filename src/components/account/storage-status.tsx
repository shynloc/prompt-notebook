"use client";

import { useEffect, useState } from "react";

interface AccountStatus {
  notes: { active: number; archived: number; trash: number };
  images: number;
  referencedImageBytes: number;
  tags: number;
  latestBackup: { status: string; createdAt: string; details: Record<string, unknown> } | null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function StorageStatus() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [integrity, setIntegrity] = useState<string>("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/v1/account/status");
    if (response.ok) setStatus((await response.json()).data);
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/account/status").then(async (response) => {
      if (active && response.ok) setStatus((await response.json()).data);
    });
    return () => { active = false; };
  }, []);

  async function emptyTrash() {
    if (!window.confirm("永久删除回收站中的笔记？此操作无法撤销。")) return;
    const response = await fetch("/api/v1/trash/empty", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 500 }),
    });
    const result = await response.json();
    setMessage(response.ok ? `已永久删除 ${result.data.deleted} 条，剩余 ${result.data.remaining} 条。` : result.error?.message);
    await refresh();
  }

  async function checkIntegrity() {
    const response = await fetch("/api/v1/media/integrity");
    const result = await response.json();
    if (!response.ok) { setMessage(result.error?.message ?? "检查失败"); return; }
    setIntegrity(`共 ${result.data.references} 个图片引用，${result.data.brokenMetadata} 个元数据异常，${result.data.orphanCandidates.length} 组疑似重复对象。`);
  }

  return (
    <section className="device-manager" aria-labelledby="storage-status-title">
      <div>
        <span className="section-kicker">STORAGE & RECOVERY</span>
        <h3 id="storage-status-title">存储与恢复状态</h3>
        <p>图片文件由图床保存；这里统计数据库中的笔记、标签和图片引用。服务器备份状态来自真实备份任务。</p>
      </div>
      {status ? (
        <dl className="status-grid">
          <div><dt>活动笔记</dt><dd>{status.notes.active}</dd></div>
          <div><dt>归档 / 回收站</dt><dd>{status.notes.archived} / {status.notes.trash}</dd></div>
          <div><dt>标签</dt><dd>{status.tags}</dd></div>
          <div><dt>图片引用</dt><dd>{status.images} · {formatBytes(status.referencedImageBytes)}</dd></div>
          <div><dt>最近服务器备份</dt><dd>{status.latestBackup ? `${status.latestBackup.status} · ${new Date(status.latestBackup.createdAt).toLocaleString("zh-CN")}` : "暂无执行记录"}</dd></div>
        </dl>
      ) : <p role="status">正在读取状态…</p>}
      <div className="data-transfer__actions">
        <button type="button" onClick={() => void checkIntegrity()}>检查图片引用</button>
        <button className="danger-action" disabled={!status?.notes.trash} type="button" onClick={() => void emptyTrash()}>清空回收站</button>
      </div>
      {integrity ? <p role="status">{integrity}</p> : null}
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </section>
  );
}
