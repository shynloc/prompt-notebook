// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createPkceChallenge, hashExtensionSecret, validateExtensionRedirectUri } from "./token-service";

describe("extension token primitives", () => {
  it("creates deterministic SHA-256 PKCE challenges without exposing the verifier", () => {
    const verifier = "a".repeat(43);
    expect(createPkceChallenge(verifier)).toBe(hashExtensionSecret(verifier));
    expect(createPkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createPkceChallenge(verifier)).not.toContain(verifier);
  });

  it("accepts Chromium identity callbacks and rejects arbitrary redirect origins", () => {
    expect(validateExtensionRedirectUri(`https://${"a".repeat(32)}.chromiumapp.org/prompt-notebook`))
      .toBe(`https://${"a".repeat(32)}.chromiumapp.org/prompt-notebook`);
    expect(() => validateExtensionRedirectUri("https://evil.example/callback")).toThrow(/无效/);
    expect(() => validateExtensionRedirectUri(`https://${"a".repeat(32)}.chromiumapp.org:444/callback`)).toThrow(/无效/);
  });
});

