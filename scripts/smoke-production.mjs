const base = (process.argv[2] ?? "https://prompts.example.com").replace(/\/$/, "");
for (const path of ["/health/live", "/health/ready", "/", "/extension", "/manifest.webmanifest", "/sw.js"]) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { redirect: "follow" });
  const elapsed = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  console.log(`${path} ${response.status} ${elapsed}ms`);
}
