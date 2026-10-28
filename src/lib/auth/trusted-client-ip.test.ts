import { describe, expect, it } from "vitest";

import { trustedClientIp } from "./trusted-client-ip";

describe("trustedClientIp", () => {
  it("ignores spoofed CF/XFF headers unless explicitly configured", () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.1" });
    expect(trustedClientIp(headers, "")).toBe("anonymous");
    expect(trustedClientIp(headers, "x-real-ip")).toBe("anonymous");
  });

  it("uses the first configured single-IP header and normalizes IPv6 case", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.1", "cf-connecting-ip": "198.51.100.1" });
    expect(trustedClientIp(headers, "x-real-ip, cf-connecting-ip")).toBe("203.0.113.1");
    expect(trustedClientIp(new Headers({ "x-real-ip": "2001:DB8::1" }), "X-Real-IP")).toBe("2001:db8::1");
  });

  it.each(["203.0.113.1, 198.51.100.1", "203.0.113.1:443", "for=203.0.113.1", "bad-ip", "fe80::1%eth0"])("rejects malformed or multi-value addresses %s", (value) => {
    expect(trustedClientIp(new Headers({ "x-real-ip": value, "cf-connecting-ip": "198.51.100.1" }), "x-real-ip,cf-connecting-ip")).toBe("anonymous");
  });

  it("safely falls back for malformed configuration", () => {
    expect(trustedClientIp(new Headers({ "x-real-ip": "203.0.113.1" }), "bad:header")).toBe("anonymous");
  });
});
