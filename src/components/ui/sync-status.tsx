"use client";

import { useEffect, useState } from "react";

export function SyncStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return (
    <span className="sync-status" data-state={online ? "online" : "offline"} role="status">
      <span aria-hidden="true" className="sync-status__dot" />
      {online ? "云端在线" : "当前离线"}
    </span>
  );
}
