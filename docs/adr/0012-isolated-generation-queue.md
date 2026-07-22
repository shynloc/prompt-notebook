# ADR-0012: Run image generation through an isolated durable queue

## Status

Accepted

## Context

Image generation can take minutes, exceed reverse-proxy request limits, require retries, and continue after a browser disconnects. Prompt Notebook currently has no background queue.

## Decision

Add a Prompt Notebook-owned Redis/BullMQ queue and a dedicated generation worker. Do not reuse ACKS Image Web Redis, queue names, workers, or database. Persist authoritative job state in PostgreSQL and start production with worker concurrency one.

## Consequences

### Positive

- Jobs survive browser refreshes and web deployments.
- Retry, backoff, cancellation, concurrency, and stale-job recovery are explicit.
- The open-source deployment remains self-contained.

### Negative

- Docker Compose gains Redis and a worker service.
- Operations must monitor queue depth and worker health.

## Alternatives Considered

- Synchronous route handlers: rejected because long requests fail unreliably through Cloudflare and Nginx.
- Share ACKS Image Web Redis: rejected because it couples two independently deployed products.
- PostgreSQL polling queue: viable, but rejected for the first professional generation implementation because BullMQ already provides the required retry and lease behavior.
