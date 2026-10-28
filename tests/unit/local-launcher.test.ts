// @vitest-environment node

import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const runAsync = promisify(execFile);
const fixtures: string[] = [];
const powershell = "powershell.exe";
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    if (!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), "prompt-local-launch-"))) throw new Error("Unsafe fixture cleanup path");
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prompt-local-launch-"));
  fixtures.push(directory);
  mkdirSync(path.join(directory, "scripts"));
  const script = path.join(directory, "scripts/start-local.ps1");
  writeFileSync(script, readFileSync("scripts/start-local.ps1"));
  return { directory, script, configuration: path.join(directory, ".env.local-docker") };
}

function completeConfiguration(filename: string) {
  const values = Object.fromEntries(readFileSync(filename, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  return values.APP_PORT === "5488" && /^[a-f0-9]{48}$/.test(values.POSTGRES_PASSWORD) &&
    /^[a-f0-9]{64}$/.test(values.BETTER_AUTH_SECRET) && /^local:[a-f0-9]{64}$/.test(values.CREDENTIAL_ENCRYPTION_KEYS);
}

describe.runIf(process.platform === "win32")("Windows local launcher atomic configuration", () => {
  it("does not leave an empty final configuration when permission setup fails", () => {
    const { directory, script, configuration } = fixture();
    const command = `function global:icacls { $global:LASTEXITCODE = 5 }; & '${script.replaceAll("'", "''")}' -ConfigureOnly`;
    const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", timeout: 15_000 });
    expect(result.status).not.toBe(0);
    expect(existsSync(configuration)).toBe(false);
    expect(readdirSync(directory)).toEqual(["scripts"]);
  });

  it("publishes one complete configuration during concurrent first launches and reuses it", async () => {
    const { directory, script, configuration } = fixture();
    const arguments_ = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ConfigureOnly"];
    const running = [runAsync(powershell, arguments_, { timeout: 20_000 }), runAsync(powershell, arguments_, { timeout: 20_000 })];
    const snapshots: boolean[] = [];
    const watch = setInterval(() => { if (existsSync(configuration)) snapshots.push(completeConfiguration(configuration)); }, 5);
    try { await Promise.all(running); } finally { clearInterval(watch); }
    expect(completeConfiguration(configuration)).toBe(true);
    expect(snapshots.every(Boolean)).toBe(true);
    expect(readdirSync(directory).sort()).toEqual([".env.local-docker", "scripts"]);
    const digest = () => createHash("sha256").update(readFileSync(configuration)).digest("hex");
    const first = digest();
    const again = await runAsync(powershell, arguments_, { timeout: 15_000 });
    expect(again.stdout).toContain("Reusing");
    expect(digest()).toBe(first);
  }, 30_000);
});
