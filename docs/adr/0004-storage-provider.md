# ADR-0004: User-owned replaceable image storage

## Status

Accepted 2026-07-19; amended 2026-07-22 by ADR-0015.

## Context

Generated artwork should not consume persistent application-container disk. A server-wide image-host token would couple every installation and every account to one operator service, prevent safe open-source defaults, and widen the impact of a credential leak.

## Decision

Domain code depends on a `StorageProvider` interface. The included provider implements a documented Picbed-compatible multipart contract. Endpoint and token belong to one application user, are configured after login, and are stored separately from notes. Tokens are encrypted server-side and never returned to the browser.

Uploads are proxied by the application so it can validate authentication, image type, byte size and decoded dimensions. User endpoints are an SSRF boundary: only public HTTPS port 443 is accepted, DNS is resolved and pinned for the request, redirects and private/reserved addresses are rejected, and provider responses are bounded.

The database stores object keys, public display URLs and metadata rather than image bytes. Other providers can implement `StorageProvider` without changing note or generation services.

## Consequences

- Installations and users are not bound to an operator-specific host.
- Provider tokens remain server-side and are isolated by account.
- The application uses upload bandwidth and must maintain the adapter contract.
- Public image URLs remain accessible to anyone who knows the URL; private signed-read support requires a future provider contract.
- Database and object storage do not share a transaction, so integrity reports and cleanup remain necessary.
