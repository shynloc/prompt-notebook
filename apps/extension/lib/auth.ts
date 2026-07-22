import { clearTokens, loadTokens, saveTokens } from "./storage";
import type { ExtensionTokens } from "./messages";
import { DEFAULT_APP_URL, getAppUrl } from "./settings";

export const APP_URL = DEFAULT_APP_URL;

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizeTokenResponse(data: { accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresIn: number; device?: ExtensionTokens["device"] }, device?: ExtensionTokens["device"]): ExtensionTokens {
  const now = Date.now();
  return {
    accessToken: data.accessToken,
    accessExpiresAt: now + data.expiresIn * 1000,
    refreshToken: data.refreshToken,
    refreshExpiresAt: now + data.refreshExpiresIn * 1000,
    device: data.device ?? device ?? { id: "unknown", name: "Chrome" },
  };
}

export async function connect(deviceName = "Chrome") {
  const appUrl = await getAppUrl();
  if (!appUrl) throw new Error("请先填写并验证你的 Prompt Notebook 服务器地址");
  const codeVerifier = randomSecret();
  const state = randomSecret();
  const codeChallenge = await pkceChallenge(codeVerifier);
  const redirectUri = chrome.identity.getRedirectURL("prompt-notebook");
  const authorizeUrl = new URL(`${appUrl}/extension/connect`);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("device_name", deviceName);
  const callback = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl.toString(), interactive: true });
  if (!callback) throw new Error("连接窗口已关闭");
  const callbackUrl = new URL(callback);
  if (callbackUrl.searchParams.get("state") !== state) throw new Error("连接状态校验失败，请重试");
  if (callbackUrl.searchParams.get("error")) throw new Error("你取消了插件连接");
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("网站没有返回授权码");
  const response = await fetch(`${appUrl}/api/v1/extension/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "无法完成插件连接");
  const tokens = normalizeTokenResponse(body.data);
  await saveTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(current: ExtensionTokens) {
  const appUrl = await getAppUrl();
  if (!appUrl) { await clearTokens(); throw new Error("请先配置 Prompt Notebook 服务器地址"); }
  if (current.refreshExpiresAt <= Date.now()) { await clearTokens(); throw new Error("插件登录已过期，请重新连接"); }
  const response = await fetch(`${appUrl}/api/v1/extension/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  const body = await response.json();
  if (!response.ok) { await clearTokens(); throw new Error(body.error?.message ?? "插件登录已失效"); }
  const tokens = normalizeTokenResponse(body.data, current.device);
  await saveTokens(tokens);
  return tokens;
}

export async function validTokens() {
  const tokens = await loadTokens();
  if (!tokens) return null;
  return tokens.accessExpiresAt > Date.now() + 30_000 ? tokens : refreshAccessToken(tokens);
}

export async function disconnect() {
  const appUrl = await getAppUrl();
  const tokens = await loadTokens();
  if (tokens && appUrl) await fetch(`${appUrl}/api/v1/extension/revoke`, { method: "POST", headers: { authorization: `Bearer ${tokens.accessToken}` } }).catch(() => undefined);
  await clearTokens();
}
