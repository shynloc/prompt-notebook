import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface CredentialContext {
  userId: string;
  connectionId: string;
  providerType: string;
}
export interface EncryptedCredential {
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  secretKeyId: string;
  secretHint: string;
}

export interface CredentialKeyRing {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

function decodeKey(value: string) {
  const normalized = value.trim();
  const key = /^[a-f0-9]{64}$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64url");
  if (key.length !== 32) {
    throw new Error("Every credential encryption key must contain exactly 32 bytes");
  }
  return key;
}

export function parseCredentialKeyRing(input: {
  serializedKeys?: string;
  activeKeyId?: string;
}): CredentialKeyRing {
  const keys = new Map<string, Buffer>();
  for (const entry of input.serializedKeys?.split(",") ?? []) {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error("Credential encryption keys must use key-id:key format");
    const keyId = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();
    if (!/^[a-zA-Z0-9._-]{1,40}$/.test(keyId)) throw new Error("Credential key ID is invalid");
    if (keys.has(keyId)) throw new Error(`Duplicate credential key ID: ${keyId}`);
    keys.set(keyId, decodeKey(encoded));
  }
  const activeKeyId = input.activeKeyId?.trim() ?? "";
  if (!activeKeyId || !keys.has(activeKeyId)) {
    throw new Error("CREDENTIAL_ACTIVE_KEY_ID must reference a configured encryption key");
  }
  return { activeKeyId, keys };
}

export function loadCredentialKeyRing(
  environment: NodeJS.ProcessEnv = process.env,
): CredentialKeyRing {
  return parseCredentialKeyRing({
    serializedKeys: environment.CREDENTIAL_ENCRYPTION_KEYS ?? environment.AI_CREDENTIAL_ENCRYPTION_KEYS,
    activeKeyId: environment.CREDENTIAL_ACTIVE_KEY_ID ?? environment.AI_CREDENTIAL_ACTIVE_KEY_ID,
  });
}

function additionalData(context: CredentialContext, keyId: string) {
  for (const [label, value] of Object.entries(context)) {
    if (!value.trim()) throw new Error(`Credential ${label} is required`);
  }
  return Buffer.from(
    ["prompt-notebook-ai-credential-v1", keyId, context.userId, context.connectionId, context.providerType].join("\u0000"),
    "utf8",
  );
}

export function credentialHint(secret: string) {
  const visible = secret.trim().slice(-4);
  return visible ? `••••${visible}` : "••••";
}

export function encryptCredential(
  secret: string,
  context: CredentialContext,
  keyRing = loadCredentialKeyRing(),
): EncryptedCredential {
  if (!secret.trim()) throw new Error("Credential cannot be empty");
  const key = keyRing.keys.get(keyRing.activeKeyId);
  if (!key) throw new Error("Active credential encryption key is unavailable");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(additionalData(context, keyRing.activeKeyId));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    encryptedSecret: encrypted.toString("base64url"),
    secretIv: iv.toString("base64url"),
    secretAuthTag: cipher.getAuthTag().toString("base64url"),
    secretKeyId: keyRing.activeKeyId,
    secretHint: credentialHint(secret),
  };
}

export function decryptCredential(
  encrypted: Omit<EncryptedCredential, "secretHint">,
  context: CredentialContext,
  keyRing = loadCredentialKeyRing(),
) {
  const key = keyRing.keys.get(encrypted.secretKeyId);
  if (!key) throw new Error(`Credential encryption key ${encrypted.secretKeyId} is unavailable`);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encrypted.secretIv, "base64url"),
  );
  decipher.setAAD(additionalData(context, encrypted.secretKeyId));
  decipher.setAuthTag(Buffer.from(encrypted.secretAuthTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedSecret, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
