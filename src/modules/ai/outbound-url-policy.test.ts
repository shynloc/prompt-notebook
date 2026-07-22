// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  isBlockedOutboundAddress,
  parseOutboundBaseUrl,
  validateOutboundBaseUrl,
} from "./outbound-url-policy";

describe("AI outbound URL policy", () => {
  it("normalizes a public HTTPS API base URL", async () => {
    const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const url = await validateOutboundBaseUrl("https://api.example.com/v1/", resolver);
    expect(url.toString()).toBe("https://api.example.com/v1");
    expect(resolver).toHaveBeenCalledWith("api.example.com");
  });

  it.each([
    "http://api.example.com/v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com:8443/v1",
    "https://localhost/v1",
    "https://service.internal/v1",
    "https://127.0.0.1/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/v1",
    "https://[::1]/v1",
  ])("rejects unsafe base URL %s", (value) => {
    expect(() => parseOutboundBaseUrl(value)).toThrow();
  });

  it("rejects public names that resolve to a private address", async () => {
    await expect(validateOutboundBaseUrl("https://api.example.com/v1", async () => [
      { address: "192.168.1.10", family: 4 },
    ])).rejects.toThrow("private or reserved");
  });

  it("blocks representative IPv4 and IPv6 special ranges", () => {
    expect(isBlockedOutboundAddress("100.64.0.1")).toBe(true);
    expect(isBlockedOutboundAddress("198.18.0.1")).toBe(true);
    expect(isBlockedOutboundAddress("198.51.100.7")).toBe(true);
    expect(isBlockedOutboundAddress("203.0.113.7")).toBe(true);
    expect(isBlockedOutboundAddress("fc00::1")).toBe(true);
    expect(isBlockedOutboundAddress("fe80::1")).toBe(true);
    expect(isBlockedOutboundAddress("ff02::1")).toBe(true);
    expect(isBlockedOutboundAddress("2001:db8::1")).toBe(true);
    expect(isBlockedOutboundAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedOutboundAddress("::ffff:0808:0808")).toBe(false);
    expect(isBlockedOutboundAddress("8.8.8.8")).toBe(false);
    expect(isBlockedOutboundAddress("2606:4700:4700::1111")).toBe(false);
  });
});
