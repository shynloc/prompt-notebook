# ADR-0013: Store generation assets only through StorageProvider

## Status

Accepted

## Context

Generated images and reference images can consume large amounts of disk and database space. ACKS Image Web currently permits a local-disk fallback and stores reference data URLs in generation rows.

## Decision

Upload reference and generated images through `StorageProvider`. Persist only bounded metadata and object references. Production generation fails safely when storage is unavailable and never falls back to application-server disk. Temporary and retained objects use separate prefixes and lifecycle policies.

## Consequences

### Positive

- Application containers remain stateless and deployable.
- PostgreSQL and queue payloads do not accumulate base64 images.
- Storage lifecycle and future signed URLs can evolve behind the adapter.

### Negative

- Image generation depends on object storage availability.
- The current public picbed exposes URLs to anyone who knows them until private signed reads are introduced.

## Alternatives Considered

- Docker volume fallback: rejected because it consumes server disk and complicates rollback.
- Base64 in PostgreSQL: rejected because it bloats rows, backups, and queue messages.
