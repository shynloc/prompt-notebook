// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

function findShell() {
  if (process.platform !== "win32") return "/bin/sh";
  try {
    const git = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const candidate = path.resolve(git, "../../../usr/bin/sh.exe");
    if (existsSync(candidate)) return candidate;
  } catch { /* Linux CI always supplies /bin/sh. */ }
  return undefined;
}
const shell = findShell();
const fixtures: string[] = [];
afterEach(() => { for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function shellPath(value: string) {
  return process.platform === "win32" ? value.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/") : value;
}

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prompt-backup-test-"));
  fixtures.push(directory);
  const bin = path.join(directory, "bin");
  const backups = path.join(directory, "backups");
  mkdirSync(bin);
  mkdirSync(backups);
  const script = path.join(directory, "backup.sh");
  writeFileSync(script, readFileSync("scripts/backup-postgres.sh", "utf8").replaceAll("\r\n", "\n"), { mode: 0o700 });
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh
case "$*" in
  *" pg_dump "*)
    printf '%s\\n' '-- PostgreSQL test dump' 'CREATE TABLE sample (id integer);'
    if [ "\${FAKE_DUMP_FAIL:-0}" = 1 ]; then exit 23; fi
    ;;
  *" psql "*) printf '%s\\n' "$*" >> "$EVENT_LOG" ;;
  *) exit 24 ;;
esac
`, { mode: 0o700 });
  // A deterministic timestamp also verifies collision handling without touching old dumps.
  writeFileSync(path.join(bin, "date"), "#!/bin/sh\nprintf '%s\\n' 20261028T000000Z\n", { mode: 0o700 });
  writeFileSync(path.join(bin, "gzip"), `#!/bin/sh
if [ "\${FAKE_COMPRESS_FAIL:-0}" = 1 ]; then printf '%s' 'partial archive'; exit 17; fi
exec /usr/bin/gzip "$@"
`, { mode: 0o700 });
  const eventLog = path.join(directory, "events.log");
  const run = (fail: boolean, compressFail = false) => spawnSync(shell!, ["-c", 'PATH="$FAKE_BIN:/usr/bin:/bin:$PATH"; export PATH; exec "$BACKUP_SCRIPT"'], {
    encoding: "utf8",
    env: {
      ...process.env, FAKE_BIN: shellPath(bin), BACKUP_SCRIPT: shellPath(script), BACKUP_DIR: shellPath(backups),
      FAKE_DUMP_FAIL: fail ? "1" : "0", FAKE_COMPRESS_FAIL: compressFail ? "1" : "0",
      EVENT_LOG: shellPath(eventLog), ENV_FILE: "", RETENTION_DAYS: "14",
    },
    timeout: 15_000,
  });
  return { backups, eventLog, run };
}

describe.runIf(Boolean(shell))("checked PostgreSQL backup publication", () => {
  it("does not publish a gzip/sidecar or success event after a partial failed pg_dump", () => {
    const { backups, eventLog, run } = fixture();
    const result = run(true);
    expect(result.status, result.stderr).not.toBe(0);
    expect(readdirSync(backups)).toEqual([]);
    expect(readFileSync(eventLog, "utf8")).toContain("'failed'");
    expect(readFileSync(eventLog, "utf8")).not.toContain("'success'");
  }, 35_000);

  it("publishes a readable successful dump with a portable SHA sidecar", () => {
    const { backups, eventLog, run } = fixture();
    const result = run(false);
    expect(result.status, result.stderr).toBe(0);
    const filename = "prompt-notebook-20261028T000000Z.sql.gz";
    const dump = readFileSync(path.join(backups, filename));
    expect(gunzipSync(dump).toString()).toContain("CREATE TABLE sample");
    expect(readFileSync(path.join(backups, `${filename}.sha256`), "utf8").trim().replace(" *", "  "))
      .toBe(`${createHash("sha256").update(dump).digest("hex")}  ${filename}`);
    expect(readFileSync(eventLog, "utf8")).toContain("'success'");
  }, 35_000);

  it("removes partial archives and temporary SQL after compression fails", () => {
    const { backups, eventLog, run } = fixture();
    const result = run(false, true);
    expect(result.status, result.stderr).not.toBe(0);
    expect(readdirSync(backups)).toEqual([]);
    expect(readFileSync(eventLog, "utf8")).toContain("'failed'");
    expect(readFileSync(eventLog, "utf8")).not.toContain("'success'");
  }, 35_000);

  it("preserves an earlier backup when a later dump fails", () => {
    const { backups, run } = fixture();
    expect(run(false).status).toBe(0);
    const before = readdirSync(backups).map((name) => [name, readFileSync(path.join(backups, name)).toString("hex")]);
    expect(run(true).status).not.toBe(0);
    expect(readdirSync(backups).map((name) => [name, readFileSync(path.join(backups, name)).toString("hex")])).toEqual(before);
  }, 35_000);

  it("never replaces a previously published backup when timestamps collide", () => {
    const { backups, run } = fixture();
    expect(run(false).status).toBe(0);
    const before = readdirSync(backups).map((name) => [name, readFileSync(path.join(backups, name)).toString("hex")]);
    expect(run(false).status).not.toBe(0);
    expect(readdirSync(backups).map((name) => [name, readFileSync(path.join(backups, name)).toString("hex")])).toEqual(before);
  }, 35_000);
});
