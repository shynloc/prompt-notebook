import { performance } from "node:perf_hooks";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 5, prepare: false });
const owner = "prompt-notebook-benchmark-user";
const benchmarkTag = "00000000-0000-4000-8000-000000000001";
const runs = Number(process.argv.find((value) => value.startsWith("--runs="))?.split("=")[1] ?? 30);

function percentile(values, value) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)].toFixed(2));
}

async function measure(name, query) {
  const samples = [];
  for (let run = 0; run < runs + 3; run += 1) {
    const start = performance.now();
    await query();
    const elapsed = performance.now() - start;
    if (run >= 3) samples.push(elapsed);
  }
  return { name, p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95), p99Ms: percentile(samples, .99), samples: samples.length };
}

const [{ count }] = await sql`select count(*)::int as count from prompt_notes where user_id = ${owner}`;
if (!count) throw new Error("No benchmark fixtures. Run npm run perf:seed first.");
const results = await Promise.all([
  measure("latest-page", () => sql`select id, title, updated_at from prompt_notes where user_id = ${owner} and deleted_at is null order by updated_at desc, id desc limit 31`),
  measure("title-search", () => sql`select id from prompt_notes where user_id = ${owner} and deleted_at is null and title ilike ${"%cinematic lighthouse%"} order by updated_at desc limit 31`),
  measure("prompt-search", () => sql`select id from prompt_notes where user_id = ${owner} and deleted_at is null and prompt ilike ${"%volumetric light%"} order by updated_at desc limit 31`),
  measure("tag-filter", () => sql`select id from prompt_notes where user_id = ${owner} and deleted_at is null and exists (select 1 from note_tags where note_id = prompt_notes.id and tag_id = ${benchmarkTag}::uuid) order by updated_at desc limit 31`),
  measure("source-host-filter", () => sql`select id from prompt_notes where user_id = ${owner} and deleted_at is null and source_url ilike ${"%://example.invalid/%"} order by updated_at desc limit 31`),
  measure("exact-duplicate-groups", () => sql`select content_hash, count(*) from prompt_notes where user_id = ${owner} and deleted_at is null and content_hash is not null group by content_hash having count(*) > 1 order by count(*) desc limit 50`),
]);
const report = { generatedAt: new Date().toISOString(), rows: count, runs, results };
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--assert") && results.some((result) => result.p95Ms > 800)) process.exitCode = 1;
await sql.end();
