import { describe, expect, it } from "vitest";

import { parseIpAddressHeaders } from "@/lib/auth/client-ip";

describe("parseIpAddressHeaders", () => {
  it("normalizes and de-duplicates configured header names", () => {
    expect(parseIpAddressHeaders(" X-Real-IP, CF-Connecting-IP, x-real-ip ")).toEqual([
      "x-real-ip",
      "cf-connecting-ip",
    ]);
  });

  it("leaves Better Auth defaults in place when no header is configured", () => {
    expect(parseIpAddressHeaders(undefined)).toBeUndefined();
    expect(parseIpAddressHeaders("  ")).toBeUndefined();
  });

  it("rejects malformed HTTP header names", () => {
    expect(() => parseIpAddressHeaders("x-real-ip, bad:header")).toThrow(
      "BETTER_AUTH_IP_ADDRESS_HEADERS",
    );
  });
});
