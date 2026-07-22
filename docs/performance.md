# Performance and capacity runbook

Prompt images live in the configured image provider. PostgreSQL stores prompt text, tags, provenance, and image metadata, so note count and search shape are the primary database variables.

## Local benchmark

Use a disposable or dedicated test database. The seed script creates one fixed owner named `prompt-notebook-benchmark-user`; cleanup deletes only that owner and its cascading fixtures.

```powershell
$env:DATABASE_URL='postgres://prompt_notebook:prompt_notebook@127.0.0.1:55432/prompt_notebook_test'
npm run perf:seed -- --count=10000
npm run perf:benchmark -- --runs=30 --assert
npm run perf:seed -- --count=100000
npm run perf:benchmark -- --runs=30 --assert
npm run perf:seed -- --cleanup
```

The supported target is p95 below 800 ms for the latest page and representative title/prompt searches at 100,000 notes. Run the one-million-note tier on a production-like disposable database, not on the live database.

## Recorded baselines

On 2026-07-20, the local PostgreSQL test container completed 30 measured runs against 100,000 deterministic notes plus a tag on every 50th note:

| Query | p50 | p95 | p99 |
|---|---:|---:|---:|
| Latest cursor page | 23.93 ms | 47.44 ms | 230.73 ms |
| Title search | 6.01 ms | 17.71 ms | 29.11 ms |
| Prompt search | 16.91 ms | 26.28 ms | 28.89 ms |
| Tag filter | 8.50 ms | 23.24 ms | 29.98 ms |

All p95 measurements remained below the 800 ms target. The benchmark owner and all 100,000 fixtures were removed after the run.

On 2026-07-19, the local PostgreSQL test container completed 20 measured runs against 10,000 deterministic notes after three warmups:

| Query | p50 | p95 | p99 |
|---|---:|---:|---:|
| Latest cursor page | 5.26 ms | 7.50 ms | 8.00 ms |
| Title search | 10.57 ms | 11.71 ms | 14.87 ms |
| Prompt search | 15.42 ms | 18.18 ms | 21.11 ms |

This is a development-machine baseline, not a production capacity guarantee. The benchmark owner and all 10,000 fixtures were removed after the run.

## Operational thresholds

- Disk alerts: 70 percent informational, 80 percent action required, 90 percent critical.
- Keep enough free space for PostgreSQL WAL, one compressed database backup, and one rollback image.
- Record database size, note growth per day, p50/p95/p99 API latency, capture error rate, and image-import success rate.
- Replay a backup into a disposable database at least monthly.

## One-million-note tier

Never run the million-note seed against production. Use a disposable PostgreSQL database with at least 12 GB free disk space and enough additional headroom for WAL and indexes:

```bash
DATABASE_URL=postgres://... npm run perf:seed -- --count=1000000
DATABASE_URL=postgres://... npm run perf:benchmark -- --runs=50 --assert
DATABASE_URL=postgres://... npm run perf:seed -- --cleanup
```

The benchmark covers latest-page cursor access, title and prompt trigram search, tag and source-host filters, and exact duplicate groups. Record PostgreSQL version, row count, database size, p50/p95/p99, disk use, and the slowest `EXPLAIN (ANALYZE, BUFFERS)` plan. The application keeps cursor pagination, owner-first composite/partial indexes, bounded duplicate candidates, and external image bytes so a larger tier can be tested without changing APIs.

### Verified local 1M result — 2026-07-20

PostgreSQL 16.14, 1,000,000 benchmark notes, 840 MB database, 50 measured samples after warm-up:

| Query | p50 | p95 | p99 |
|---|---:|---:|---:|
| Latest page | 226.10 ms | 280.97 ms | 294.04 ms |
| Title search | 113.92 ms | 181.26 ms | 221.53 ms |
| Prompt search | 181.18 ms | 248.87 ms | 260.04 ms |
| Tag filter | 176.91 ms | 237.64 ms | 287.67 ms |
| Source-host filter | 258.80 ms | 308.88 ms | 349.49 ms |
| Exact duplicate groups | 340.94 ms | 650.54 ms | 699.17 ms |

All p95 results passed the 800 ms gate. The slowest plan used an index-only scan on `prompt_notes_user_content_hash_idx`, zero heap fetches, 221,327 shared-buffer hits, and 389.01 ms execution time while proving that all one million hashes were unique. This worst case intentionally scans every hash; accounts with actual duplicate groups still remain bounded to 50 returned groups.
- Inspect slow searches with `EXPLAIN (ANALYZE, BUFFERS)` before adding infrastructure.
- Consider a separate search service only after indexed PostgreSQL search fails the measured target at sustained production volume.
