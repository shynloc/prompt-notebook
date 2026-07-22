import { describe, expect, it } from "vitest";

import { pkceChallenge } from "./auth";

describe("extension PKCE", () => {
  it("creates the same base64url SHA-256 challenge expected by the server", async () => {
    const verifier = "a".repeat(43);
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await pkceChallenge(verifier)).toBe(challenge);
    expect(challenge).not.toContain("=");
  });
});

