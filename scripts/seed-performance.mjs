import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const requested = Number(process.argv.find((value) => value.startsWith("--count="))?.split("=")[1] ?? 10_000);
if (!Number.isInteger(requested) || requested < 1 || requested > 1_000_000) throw new Error("--count must be between 1 and 1000000");
const benchmarkUserId = "prompt-notebook-benchmark-user";
const benchmarkTagId = "00000000-0000-4000-8000-000000000001";
const email = "benchmark@prompt-notebook.invalid";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

if (process.argv.includes("--cleanup")) {
  await sql`delete from "user" where id = ${benchmarkUserId}`;
  await sql.end();
  console.log("Removed only the Prompt Notebook benchmark owner and cascading fixtures");
  process.exit(0);
}

await sql`insert into "user" (id, name, email, email_verified) values (${benchmarkUserId}, 'Performance benchmark', ${email}, true) on conflict (id) do nothing`;
const [{ count }] = await sql`select count(*)::int as count from prompt_notes where user_id = ${benchmarkUserId}`;
const batchSize = 5_000;
for (let offset = Number(count); offset < requested; offset += batchSize) {
  const length = Math.min(batchSize, requested - offset);
  const rows = Array.from({ length }, (_, position) => {
    const index = offset + position;
    const prompt = `deterministic performance fixture ${index}; ${index % 113 === 0 ? "cinematic lighthouse at blue hour, volumetric light" : "balanced composition, detailed texture, natural light"}`;
    return {
      id: randomUUID(),
      user_id: benchmarkUserId,
      title: `Benchmark prompt ${index} ${index % 97 === 0 ? "cinematic lighthouse" : "visual study"}`,
      prompt,
      content_hash: createHash("md5").update(`${prompt.toLocaleLowerCase()}\n`).digest("hex"),
      capture_method: index % 4 === 0 ? "extension" : "web",
      source_url: index % 4 === 0 ? `https://example.invalid/prompts/${index}` : null,
      captured_at: index % 4 === 0 ? new Date() : null,
    };
  });
  await sql`insert into prompt_notes ${sql(rows, "id", "user_id", "title", "prompt", "content_hash", "capture_method", "source_url", "captured_at")}`;
  console.log(`Seeded ${Math.min(offset + length, requested).toLocaleString()} / ${requested.toLocaleString()}`);
}
await sql`insert into tags (id, user_id, name) values (${benchmarkTagId}, ${benchmarkUserId}, 'benchmark-cinematic') on conflict (user_id, name) do nothing`;
await sql`
  insert into note_tags (note_id, tag_id, user_id)
  select ranked.id, ${benchmarkTagId}::uuid, ${benchmarkUserId}
  from (select id, row_number() over (order by id) as position from prompt_notes where user_id = ${benchmarkUserId}) ranked
  where ranked.position % 50 = 0
  on conflict do nothing
`;
await sql.end();
