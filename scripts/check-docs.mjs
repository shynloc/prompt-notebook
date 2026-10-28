import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documents = [
  "README.md",
  "docs/installation.md",
  "docs/configuration.md",
  "docs/backup-and-restore.md",
  "docs/verification/2026-10-28-public-readiness.md",
];
const illustrations = new Set(["docs/readme/hero.svg", "docs/readme/workflow.svg"]);
const read = (file) => readFileSync(path.join(root, file), "utf8");
const visibleMarkdown = (source) => source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");

function anchors(source) {
  const ids = new Set([...source.matchAll(/<a\s+id="([^"]+)"/g)].map((match) => match[1]));
  const counts = new Map();
  for (const match of visibleMarkdown(source).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = match[1].trim().toLowerCase().replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    ids.add(count ? `${slug}-${count}` : slug);
  }
  return ids;
}

let links = 0;
for (const file of documents) {
  const source = read(file);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `${file}: unclosed code fence`);
  for (const [, target] of visibleMarkdown(source).matchAll(/\]\(([^\s)]+)\)/g)) {
    links += 1;
    if (/^https:\/\//.test(target)) { new URL(target); continue; }
    assert(!/^[a-z][a-z\d+.-]*:/i.test(target), `${file}: unexpected link protocol`);
    const [relative, fragment] = target.split("#");
    const actual = relative ? path.resolve(root, path.dirname(file), decodeURIComponent(relative)) : path.resolve(root, file);
    assert(actual === root || actual.startsWith(`${root}${path.sep}`), `${file}: link outside repository`);
    assert(existsSync(actual), `${file}: missing link target ${target}`);
    if (fragment && actual.endsWith(".md")) {
      assert(anchors(readFileSync(actual, "utf8")).has(decodeURIComponent(fragment)), `${file}: missing anchor ${target}`);
    }
  }
}

const readme = visibleMarkdown(read("README.md"));
assert(!/<(?:picture|source|svg|iframe|object|embed|script)\b/i.test(readme), "README must not bypass image provenance with embedded content");
const seen = new Set();
const sources = [
  ...[...readme.matchAll(/!\[[^\]]*\]\(([^\s)]+)\)/g)].map((match) => match[1]),
  ...[...readme.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]),
];
for (const source of sources) {
  if (source.startsWith("https://")) {
    assert.equal(new URL(source).origin, "https://img.shields.io", "README remote images must be badges only");
  } else {
    assert(illustrations.has(source), "README images must be approved synthetic SVGs, never real screenshots");
    seen.add(source);
  }
}
assert.deepEqual(seen, illustrations, "README must include both original illustrations");
for (const file of illustrations) {
  const svg = read(file);
  assert(svg.includes("<svg") && svg.includes("SYNTHETIC ILLUSTRATION"), `${file}: missing provenance label`);
  assert(!/<(?:script|foreignObject|image)\b|<!DOCTYPE|<!ENTITY|\son[a-z]+\s*=/i.test(svg), `${file}: executable/embedded content`);
  assert(!/(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?:https?:|data:|\/\/)/i.test(svg), `${file}: external resource`);
}
console.log(`Documentation checks passed: ${documents.length} documents, ${links} links, two synthetic-only SVG illustrations.`);
