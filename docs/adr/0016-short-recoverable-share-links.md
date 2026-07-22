# ADR-0016: Short, recoverable, expiring share links

## Status

Accepted — 2026-07-22

## Context

The original public-share token was deliberately long and returned only once. It was secure but awkward to recognize and could not be copied again from an owner management screen. The product now requires a short dated link, visible validity metadata, renewal, and centralized management.

## Decision

New public-share paths contain an eight-digit UTC creation date and a five-character cryptographically random case-sensitive code. PostgreSQL stores a unique SHA-256 hash for public lookup. It also stores an AES-256-GCM encrypted copy of the token, bound to the owner and share ID, so authenticated owners can copy an existing active link. The same rotatable server key ring used for other user-owned credentials protects this value.

Owner APIs return active, non-revoked shares only. Renewal adds seven days to the existing expiry. Revocation invalidates the link immediately. Legacy hashed long tokens remain readable until their original expiry, but are replaced with the new format when the owner shares that note again.

## Consequences

- Links are easier to share and can be recovered from authenticated product UI.
- The date prefix is descriptive, not secret; effective random space is 57^5. Public reads remain expiry-bound, revocable, and rate-limited.
- The credential encryption key ring is required to re-display a link, but losing it does not expose the token or stop hash-based public validation.
- Unique hash enforcement and bounded generation retries handle collisions.
