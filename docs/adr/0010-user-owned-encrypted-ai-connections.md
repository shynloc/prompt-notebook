# ADR-0010: Use user-owned encrypted AI connections

## Status

Accepted

## Context

Users need multiple persistent model configurations. API keys must survive device changes without being exposed to the browser, logs, exports, other users, or ACKS Image Web.

## Decision

Store user-owned provider connections in Prompt Notebook PostgreSQL. Encrypt each secret with AES-256-GCM and a versioned server-side key ring. Bind ciphertext to the owner and connection metadata with authenticated additional data. Return only non-secret metadata and a masked hint.

## Consequences

### Positive

- Configuration follows the user's Prompt Notebook account across devices.
- Secrets remain server-side and independently rotatable.
- Account deletion cascades through AI configuration data.

### Negative

- Losing every configured encryption key makes stored credentials unrecoverable.
- Backup and restore procedures must preserve the encryption key ring separately from the database.

## Alternatives Considered

- Browser-only storage: rejected because it does not survive device changes and exposes keys to client code.
- Plaintext database storage: rejected as an unacceptable credential risk.
- Reuse ACKS Image Web credentials: rejected because user IDs, encryption keys, deployment, and open-source boundaries differ.
