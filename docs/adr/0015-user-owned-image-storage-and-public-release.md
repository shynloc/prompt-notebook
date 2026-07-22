# ADR-0015: User-owned image storage and clean public release

## Status

Accepted — 2026-07-22

## Context

Prompt Notebook must be deployable from a public repository without an operator domain, WordPress installation, shared image-host token or model credential. A deployed instance also needs a safe way to follow current releases while protecting data.

## Decision

Image-host and model connections are user-owned settings encrypted by one rotatable server key ring. No provider endpoint or token is embedded in source, images or the Chrome extension. The extension ships without a server origin and requests optional permission only after the user validates their own origin.

The public repository is licensed MIT and published from a sanitized history. Release tags contain a generic Chrome ZIP and container image. The supplied systemd update timer follows `main`, creates a verified PostgreSQL backup before change, builds an immutable revision image, runs forward migrations, probes readiness, and restores the prior application revision on failure. It refuses tracked local modifications.

## Consequences

- A fork can be deployed with only infrastructure secrets; provider settings happen in the product UI.
- The server credential key ring becomes critical recovery material and must be backed up separately.
- Automatic updates trade review latency for freshness; security-conscious operators can disable the timer and deploy signed/reviewed tags manually.
- Database rollback is not automatic, so migrations must remain forward-compatible and backups remain mandatory.
