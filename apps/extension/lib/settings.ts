export const DEFAULT_APP_URL = (import.meta.env.VITE_APP_URL || "").replace(/\/$/, "");
const SETTINGS_KEY = "promptNotebook.settings";

export interface ExtensionSettings { appUrl: string }

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return (result[SETTINGS_KEY] as ExtensionSettings | undefined) ?? { appUrl: DEFAULT_APP_URL };
}

export async function getAppUrl() { return (await getSettings()).appUrl; }

export async function saveAppUrl(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("请输入不含路径的服务器地址");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("自建服务器必须使用 HTTPS（localhost 除外）");
  const appUrl = url.origin;
  const granted = await chrome.permissions.request({ origins: [`${appUrl}/*`] });
  if (!granted) throw new Error("需要该服务器的访问权限才能连接");
  const response = await fetch(`${appUrl}/health/live`, { cache: "no-store" });
  if (!response.ok) throw new Error("服务器健康检查失败");
  await chrome.storage.local.set({ [SETTINGS_KEY]: { appUrl } satisfies ExtensionSettings });
  return appUrl;
}
