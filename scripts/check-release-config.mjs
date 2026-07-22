import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "deploy/compose.production.yml",
  "deploy/systemd/prompt-notebook-backup.service",
  "deploy/systemd/prompt-notebook-backup.timer",
  "scripts/backup-postgres.sh",
  "scripts/restore-postgres.sh",
  "apps/extension/public/manifest.json",
  "docs/license-decision.md",
];
const failures = requiredFiles.filter((file) => !existsSync(file)).map((file) => `missing ${file}`);
const manifest = JSON.parse(readFileSync("apps/extension/public/manifest.json", "utf8"));
const productionCompose = readFileSync("deploy/compose.production.yml", "utf8");
if (manifest.manifest_version !== 3) failures.push("extension must use Manifest V3");
if (manifest.host_permissions?.some((permission) => permission === "<all_urls>" || permission.includes("*://*"))) failures.push("extension has an unconditional broad host permission");
if (!manifest.optional_host_permissions?.includes("https://*/*")) failures.push("extension custom-server permission is missing");
if ((productionCompose.match(/REDIS_URL:/g) ?? []).length < 3) failures.push("production web, migrate, and generation worker must all receive REDIS_URL");

const production = process.argv.includes("--production");
if (production) {
  try { if (new URL(process.env.APP_URL ?? "").protocol !== "https:") failures.push("APP_URL must be HTTPS"); } catch { failures.push("APP_URL is invalid"); }
  if ((process.env.BETTER_AUTH_SECRET ?? "").length < 32) failures.push("BETTER_AUTH_SECRET must be at least 32 characters");
  for (const name of ["POSTGRES_PASSWORD", "CREDENTIAL_ENCRYPTION_KEYS", "CREDENTIAL_ACTIVE_KEY_ID"]) if (!process.env[name]) failures.push(`${name} is required`);
  const keyEntries = (process.env.CREDENTIAL_ENCRYPTION_KEYS ?? "").split(",").filter(Boolean);
  const keyIds = new Set();
  for (const entry of keyEntries) {
    const separator = entry.indexOf(":");
    const keyId = entry.slice(0, separator);
    const encoded = entry.slice(separator + 1);
    if (separator <= 0 || !/^[a-zA-Z0-9._-]{1,40}$/.test(keyId)) { failures.push("credential key ring has an invalid key ID"); continue; }
    if (keyIds.has(keyId)) failures.push(`duplicate credential key ID ${keyId}`);
    keyIds.add(keyId);
    const key = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, "hex") : Buffer.from(encoded, "base64url");
    if (key.length !== 32) failures.push(`credential key ${keyId} must contain exactly 32 bytes`);
  }
  if (!keyIds.has(process.env.CREDENTIAL_ACTIVE_KEY_ID)) failures.push("CREDENTIAL_ACTIVE_KEY_ID must reference the configured key ring");
}
if (!existsSync("apps/extension/dist/manifest.json")) failures.push("extension build output is missing; run npm run extension:build");
if (failures.length) { console.error(failures.map((failure) => `- ${failure}`).join("\n")); process.exit(1); }
console.log(`Release configuration is valid${production ? " for production" : ""}.`);
