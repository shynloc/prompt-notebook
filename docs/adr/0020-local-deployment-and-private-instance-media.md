# ADR-0020: Local deployment and private instance-managed image storage

## Status

Accepted, 2026-10-28. Extends ADR-0004/0006/0015 and supersedes the external-object-storage-only constraint of ADR-0013 where instance storage is selected.

## Context

Users without a server or image host should still be able to use the complete notebook locally. Server operators also need an alternative to a third-party image host. Existing user-owned Picbed credentials and previously saved images must continue to work. A local convenience mode must not silently weaken production signup, expose user files publicly, or bypass outbound SSRF protection.

## Decision

1. Reuse the same Web/PostgreSQL/Redis/worker application through Docker Desktop or Linux Docker, not a separate desktop codebase. Local launch helpers generate independent persistent secrets, bind the app to loopback and retain database/media volumes across restart/update.
2. Introduce explicit `APP_DEPLOYMENT_MODE=local|server`. Local mode is valid only with a strict HTTP loopback APP_URL. Only that mode can omit production SMTP/email verification. Server mode keeps existing verification and mail requirements. Local mode is not a supported LAN/public-server shortcut.
3. Offer per-account active storage selection: `local` (instance-managed files) or `picbed` (existing external protocol). New users default to local; existing configured Picbed accounts remain Picbed unless they explicitly switch. Selection affects future uploads only, with no automatic asset migration or destruction of stored provider secrets.
4. Keep local files outside the public directory, under an administrator-controlled persistent root shared by Web and worker. Use opaque IDs, owner-scoped database records, validated raster bytes, exclusive writes, restrictive permissions, path/symlink containment, per-user quota accounting and bounded file sizes.
5. Private media routes require the owning session. Public shares use a narrow, expiring token route for the share's single cover image; a share never grants access to the user's full image library. Internal generation/reverse/reference reads resolve only owned recorded assets, not arbitrary local URLs or filesystem paths.
6. Persist local objects/preferences in indexed PostgreSQL tables with user foreign keys. Keep provider-specific external credentials in their existing encrypted table. File usage is checked under a per-user database lock so parallel uploads cannot pass the same quota simultaneously.
7. Preserve outbound HTTPS/DNS policy for external APIs and images. Internal file reads are an explicit local-storage capability, not an exception allowing arbitrary loopback fetches.
8. Backups must include PostgreSQL, the local-media volume, encryption keys and any external-host files. Metadata-only account exports are not image archives. Account deletion/cleanup must handle local file ownership explicitly and avoid deleting another account's assets.

## Consequences

### Positive

- Users can run the application on their own computer without a domain, SMTP or external image host.
- Server deployments can choose their own disk or an external provider, while retaining existing data and credentials.
- One application and migration stream avoids inconsistent desktop/server feature sets.
- Local images are private by default and share permissions are explicit and revocable.

### Negative

- Docker Desktop remains a local prerequisite; this release is not a native installer or single-file executable.
- Instance storage consumes the operator's disk and requires capacity monitoring, quotas and a separate media backup.
- Local mode does not provide cross-device access automatically. A loopback origin is deliberately not exposed on the LAN.
- Filesystem and database commits cannot form a single atomic transaction; failed writes require cleanup and crash/orphan behavior must be documented and tested.

## Alternatives considered

- Native desktop/Electron plus SQLite: deferred because it adds packaging, updater and storage divergence without being needed for the requested local Web workflow.
- Unauthenticated files in `public/uploads`: rejected because unpredictable URLs alone do not provide account isolation or revocable sharing.
- Requiring everyone to deploy an image host: rejected because it is the adoption barrier being removed.
- Broadly permitting localhost API fetches: rejected because local deployment does not justify SSRF bypasses.

## Verification requirements

Loopback-only mode validation, no-SMTP local signup, unchanged server verification, secret-safe launch/restart, volume retention, private owner/other-user reads, traversal/symlink rejection, concurrent quota enforcement, storage switching with old asset readability, valid/expired/revoked shares, note/role/generation/reverse workflows, account deletion, backup producer failure and complete CI/build checks.
