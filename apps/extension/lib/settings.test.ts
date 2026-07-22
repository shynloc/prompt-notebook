import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveAppUrl } from "./settings";

describe("custom server settings", () => {
  beforeEach(() => {
    Object.assign(globalThis, { chrome: { permissions: { request: vi.fn().mockResolvedValue(true) }, storage: { local: { set: vi.fn() } } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  it("requires HTTPS and validates health before saving", async () => {
    await expect(saveAppUrl("http://remote.example")).rejects.toThrow(/HTTPS/);
    await expect(saveAppUrl("https://selfhost.example")).resolves.toBe("https://selfhost.example");
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ["https://selfhost.example/*"] });
    expect(fetch).toHaveBeenCalledWith("https://selfhost.example/health/live", { cache: "no-store" });
  });
});
