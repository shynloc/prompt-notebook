# Local Deployment and Storage Implementation Plan

**Goal:** Support a complete local Docker Web app and selectable private instance/external image storage, while patching current security advisories and preserving existing server accounts and images.

**Architecture:** Follow ADR-0020. Reuse the current modular monolith and PostgreSQL/Redis workers; add explicit loopback-only local mode and owner-scoped private media objects in a persistent shared volume. Keep existing Picbed credentials and external SSRF policies intact.

**Tech Stack:** Next.js/React/TypeScript, Better Auth, PostgreSQL/Drizzle, Redis/BullMQ, Node filesystem APIs, Docker Compose, PowerShell/POSIX launchers, Vitest and Playwright.

## Task 1: Patch runtime dependencies

Files: `package.json`, `package-lock.json`, versioned extension manifests and release notes.

1. Confirm patched official releases for Next.js/lint preset, Better Auth/adapters, Nodemailer and Zod; do not force an incompatible major downgrade.
2. Install patched compatible releases and run `npm audit --omit=dev` (expected: zero production advisories).
3. Repeat authentication/schema/provider tests after all modules are integrated. Treat newly introduced API differences as failures to fix, not reasons to silence tests.

## Task 2: Add isolated local deployment

Files: `src/lib/deployment/config.ts`, auth/email modules, `deploy/compose.local.yml`, local example environment, `scripts/start-local.ps1`, `scripts/start-local.sh`, production Compose and installation docs.

1. Add failing configuration tests for invalid modes, external origins and loopback lookalikes.
2. Implement explicit HTTP-loopback-only local mode and conditional local email/verification behavior; test production behavior remains unchanged.
3. Generate independent secrets once, retain existing env/volumes on restart, use loopback ports and a separate local Compose project.
4. Share a private persistent media volume between Web and worker with non-root ownership; never chmod 777.
5. Run local startup/signup/upload/restart checks without a real SMTP/model provider.

## Task 3: Add private instance media and user selection

Files: media modules, `src/db/schema/media.ts`, media routes, generation read/store code, note/character/transfer schemas and sharing service.

1. Write tests for new-user local defaults, existing Picbed defaults and round-trip switching without credential loss.
2. Add preference and local-object tables with owner indexes and quota accounting; root generates an additive migration after schemas settle.
3. Implement bounded raster writes/reads outside `public`, fixed file IDs, owner authorization, restrictive permissions, traversal/symlink containment and disk/quota errors.
4. Integrate local reads through generation, character references, reverse prompts, notes and history without loosening remote-network policy.
5. Implement private media and token-scoped public cover routes; test other-user, expired/revoked share and object-substitution rejection.
6. Verify account deletion/retention and document that file backups are separate from JSON export/database dumps.

## Task 4: Ship clear storage UX

Files: storage settings components/styles/tests, shared client image types, settings labels and `tests/e2e/storage.spec.ts`.

1. Show instance storage vs external image host as explicit options, quota usage, provider-specific fields and saved-state feedback.
2. Guard duplicate actions and keep pending/errors visible. Do not let users enter arbitrary server filesystem paths.
3. Cover local upload, multi-image preview, note/role/generation reuse, switching with old asset readability and desktop/mobile layout.

## Task 5: Harden backup failure detection

Files: `scripts/backup-postgres.sh`, isolated script tests and recovery documentation.

1. Reproduce failed `pg_dump` with successful compression using a fake Docker executable and isolated temporary files.
2. Require producer success before publishing a compressed dump/sidecar; clean only validated temporary targets.
3. Check success, producer/compressor failure and retention behavior without touching production databases.

## Task 6: Documentation, audit and release

Files: README, configuration/installation/backup docs, ADR index, public-readiness report and verification record.

1. Update the already redesigned README with local launch steps, two storage modes and accurate privacy/backup/migration boundaries. Keep all visuals synthetic.
2. Run document checks, lint/type/unit/integration/extension/browser tests, migrations, builds, release config and dependency audit.
3. Review the integrated diff and release through the existing PR/CI workflow. Use GitHub noreply for new commits; do not rewrite past identities or tags.
4. Back up production before migration, deploy exact tested revision, restore the update timer and verify public readiness, Web/worker versions, private media access and release artifacts. Do not spend user model credits as part of automated tests.
