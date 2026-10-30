// @vitest-environment node

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  decryptCredential,
  encryptCredential,
  parseCredentialKeyRing,
} from "./credential-crypto";

const context = {
  userId: "user-a",
  connectionId: "connection-a",
  providerType: "openai_compatible",
};

function ring(activeKeyId = "current") {
  return parseCredentialKeyRing({
    activeKeyId,
    serializedKeys: `old:${randomBytes(32).toString("base64url")},current:${randomBytes(32).toString("hex")}`,
  });
}

describe("AI credential encryption", () => {
  it("round-trips a secret without storing it in plaintext", () => {
    const keyRing = ring();
    const encrypted = encryptCredential("sk-example-secret", context, keyRing);
    expect(encrypted.encryptedSecret).not.toContain("example-secret");
    expect(encrypted.secretHint).toBe("••••cret");
    expect(decryptCredential(encrypted, context, keyRing)).toBe("sk-example-secret");
  });

  it("binds ciphertext to the owner and connection metadata", () => {
    const keyRing = ring();
    const encrypted = encryptCredential("sk-example-secret", context, keyRing);
    expect(() => decryptCredential(encrypted, { ...context, userId: "user-b" }, keyRing)).toThrow();
    expect(() => decryptCredential(encrypted, { ...context, connectionId: "connection-b" }, keyRing)).toThrow();
  });

  it("decrypts old records while new records use the active key", () => {
    const keys = ring("old");
    const oldEncrypted = encryptCredential("old-secret", context, keys);
    const rotated = { ...keys, activeKeyId: "current" };
    const newEncrypted = encryptCredential("new-secret", context, rotated);
    expect(oldEncrypted.secretKeyId).toBe("old");
    expect(newEncrypted.secretKeyId).toBe("current");
    expect(decryptCredential(oldEncrypted, context, rotated)).toBe("old-secret");
  });

  it("rejects malformed, duplicate, and missing active keys", () => {
    const valid = randomBytes(32).toString("base64url");
    expect(() => parseCredentialKeyRing({ serializedKeys: `one:${valid}`, activeKeyId: "two" })).toThrow();
    expect(() => parseCredentialKeyRing({ serializedKeys: "one:short", activeKeyId: "one" })).toThrow();
    expect(() => parseCredentialKeyRing({ serializedKeys: `one:${valid},one:${valid}`, activeKeyId: "one" })).toThrow();
  });
});
