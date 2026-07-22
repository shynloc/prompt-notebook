# ADR-0009: Scale PostgreSQL with measured thresholds

## Status

Accepted

## Context

The product must remain responsive as accounts accumulate tens of thousands of prompts. Images already live outside PostgreSQL, but search, indexes, backups, logs, and disk headroom require explicit targets.

## Decision

Keep PostgreSQL as the system of record and use cursor pagination, owner-prefixed indexes, and `pg_trgm` search indexes. Add repeatable 10k, 100k, and 1m-note data generation and query benchmarks before considering a separate search service.

Initial targets are list/search p95 below 800 ms at 100k notes per benchmark owner, ordinary API p95 below 500 ms, and text-only capture p95 below 800 ms. Track disk and database growth, alert at 70/80/90 percent, retain verified backups, and clean obsolete container artifacts.

## Consequences

### Positive

- Scaling decisions are based on measurements rather than estimates.
- Existing PostgreSQL features cover the next growth stage.
- No new always-on infrastructure is required now.

### Negative

- Performance fixtures consume temporary database space.
- Benchmark results depend on production-like hardware and data shape.

## Alternatives Considered

- Add Elasticsearch or OpenSearch now: rejected as premature operational complexity.
- Offset pagination: rejected because cost and consistency degrade on deep pages.
- Partition immediately: rejected until measured row counts justify it.

