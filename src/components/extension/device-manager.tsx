"use client";

import { useEffect, useState } from "react";

interface ExtensionDevice {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
}

export function DeviceManager() {
  const [devices, setDevices] = useState<ExtensionDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/extension/devices").then(async (response) => {
      if (active && response.ok) setDevices((await response.json()).data);
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function revoke(device: ExtensionDevice) {
    if (!window.confirm(`撤销“${device.name}”的插件访问权限吗？`)) return;
    const response = await fetch(`/api/v1/extension/devices/${device.id}`, { method: "DELETE" });
    if (!response.ok) { setMessage("撤销失败，请刷新后重试。"); return; }
    setDevices((current) => current.map((item) => item.id === device.id ? { ...item, revokedAt: new Date().toISOString() } : item));
    setMessage("设备授权已撤销。该插件需要重新连接才能继续保存。");
  }

  return (
    <section className="device-manager" aria-labelledby="extension-devices-title">
      <div><span className="section-kicker">CONNECTED DEVICES</span><h3 id="extension-devices-title">Chrome 插件设备</h3><p>插件使用独立令牌，不会读取你的网站登录 Cookie。可以随时撤销丢失或不再使用的设备。</p></div>
      <p><a href="/extension">下载插件并查看安装说明</a></p>
      {loading ? <p>正在读取设备…</p> : devices.length ? <div className="device-list">{devices.map((device) => <article key={device.id} className={device.revokedAt ? "device-item device-item--revoked" : "device-item"}>
        <div><strong>{device.name}</strong><span>{device.revokedAt ? "已撤销" : "已连接"}</span><small>最近使用：{new Date(device.lastUsedAt).toLocaleString("zh-CN")}</small></div>
        {!device.revokedAt ? <button type="button" onClick={() => void revoke(device)}>撤销访问</button> : null}
      </article>)}</div> : <p className="empty-copy">尚未连接 Chrome 插件。</p>}
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </section>
  );
}
