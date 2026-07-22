# Prompt Notebook Phase 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the five approved next-stage batches: operational safety, professional prompt management, advanced discovery, capture/sharing, and open-release readiness.

**Architecture:** Keep the existing Next.js modular monolith and PostgreSQL authority model. Add normalized owner-scoped tables for history, projects, templates, shares, cleanup state, and metrics; preserve cursor pagination and short transactions. Use the existing Chrome MV3 authorization model and Docker Compose deployment without adding a mandatory external service.

**Tech Stack:** Next.js 16, React 19, TypeScript, Better Auth, PostgreSQL 16, Drizzle ORM, Zod, IndexedDB, Chrome Manifest V3, Vitest, Playwright, Docker Compose.

---

## Task 1: Account safety, retention, storage integrity, and monitoring

**Files:**

- Modify: `src/db/schema/auth.ts`
- Modify: `src/db/schema/notes.ts`
- Create: `src/db/schema/operations.ts`
- Create: `src/modules/account/account-service.ts`
- Create: `src/app/api/v1/account/delete/route.ts`
- Create: `src/app/api/v1/account/status/route.ts`
- Create: `src/app/api/v1/trash/empty/route.ts`
- Create: `src/app/api/v1/media/integrity/route.ts`
- Create: `src/components/account/danger-zone.tsx`
- Create: `src/components/account/storage-status.tsx`
- Modify: `src/app/profile/page.tsx`
- Create: `deploy/systemd/prompt-notebook-backup.service`
- Create: `deploy/systemd/prompt-notebook-backup.timer`
- Test: `tests/integration/account-operations.test.ts`
- Test: `tests/e2e/account-safety.spec.ts`

**Steps:**

1. Write failing tests for password-confirmed account deletion, cross-user denial, trash purge, integrity reports, and status summaries.
2. Add owner-scoped schemas and indexes, generate a migration, and replay it on the disposable database.
3. Implement short transactional account deletion and trash purge; never call external storage inside a transaction.
4. Add image-reference integrity reporting and explicit orphan candidates without automatically deleting provider objects.
5. Add account danger-zone and storage/backup status UI with typed confirmation.
6. Install daily backup timer definitions, checksum verification, retention, and failure status output.
7. Run security audit, integration tests, responsive screenshots, and commit.

## Task 2: History, templates, projects, smart collections, and bulk actions

**Files:**

- Create: `src/db/schema/productivity.ts`
- Modify: `src/modules/notes/note-repository.ts`
- Modify: `src/modules/notes/note-service.ts`
- Create: `src/modules/history/history-service.ts`
- Create: `src/modules/projects/project-service.ts`
- Create: `src/modules/templates/template-service.ts`
- Create: `src/app/api/v1/notes/[id]/versions/route.ts`
- Create: `src/app/api/v1/notes/[id]/versions/[versionId]/restore/route.ts`
- Create: `src/app/api/v1/notes/bulk/route.ts`
- Create: `src/app/api/v1/projects/route.ts`
- Create: `src/app/api/v1/templates/route.ts`
- Create: `src/app/projects/page.tsx`
- Create: `src/app/templates/page.tsx`
- Create: `src/components/notes/bulk-toolbar.tsx`
- Modify: `src/components/editor/prompt-editor.tsx`
- Test: `tests/integration/productivity-api.test.ts`
- Test: `tests/e2e/productivity.spec.ts`

**Steps:**

1. Write failing tests for immutable history, restore conflicts, project ownership, template rendering, and batch limits.
2. Add normalized tables, foreign-key indexes, unique constraints, and a migration.
3. Capture history in the same short note-update transaction and enforce retention.
4. Implement variable templates with bounded names, values, and deterministic preview rendering.
5. Implement projects and saved smart filters without duplicating note content.
6. Implement batch favorite/archive/delete/tag/project actions with a maximum batch size and one transaction.
7. Add responsive history, template, project, and multi-select UI; verify and commit.

## Task 3: Duplicate detection and advanced search

**Files:**

- Modify: `src/db/schema/notes.ts`
- Modify: `src/modules/notes/note-schema.ts`
- Modify: `src/modules/notes/note-repository.ts`
- Create: `src/modules/search/search-service.ts`
- Create: `src/app/api/v1/notes/duplicates/route.ts`
- Create: `src/components/notes/advanced-filters.tsx`
- Modify: `src/components/notes/note-gallery.tsx`
- Modify: `scripts/benchmark-notes.mjs`
- Test: `tests/integration/search-api.test.ts`
- Test: `tests/e2e/advanced-search.spec.ts`

**Steps:**

1. Write failing tests for normalized exact hashes, trigram candidates, all filter combinations, saved filters, and cursor stability.
2. Add generated/search support and partial/composite indexes that match active-note query predicates.
3. Implement exact duplicate detection first and bounded similarity candidates second.
4. Add source host, date range, project, tag, image, favorite, archive, and field-specific filters.
5. Add highlighted results and saved-search controls while preserving accessible plain text.
6. Extend 100k and 1m-capable benchmarks, record query plans, verify, and commit.

## Task 4: Extension resilience, quick capture, and revocable sharing

**Files:**

- Modify: `apps/extension/public/manifest.json`
- Modify: `apps/extension/lib/auth.ts`
- Create: `apps/extension/lib/settings.ts`
- Modify: `apps/extension/entrypoints/sidepanel/App.tsx`
- Modify: `apps/extension/entrypoints/background.ts`
- Create: `src/db/schema/sharing.ts`
- Create: `src/modules/sharing/share-service.ts`
- Create: `src/app/api/v1/shares/route.ts`
- Create: `src/app/api/v1/shares/[id]/route.ts`
- Create: `src/app/share/[token]/page.tsx`
- Create: `src/components/sharing/share-manager.tsx`
- Modify: `src/components/notes/note-lightbox.tsx`
- Test: `tests/integration/sharing-api.test.ts`
- Test: `tests/e2e/sharing.spec.ts`

**Steps:**

1. Write failing tests for custom server validation, retained capture drafts, retry/idempotency, share expiry, revocation, and privacy.
2. Add extension settings and optional host permissions using Chrome runtime permission requests.
3. Improve candidate-image provenance, recent saves, duplicate warnings, and offline retry.
4. Add quick duplicate-as-new and paste/drop capture paths to the web editor.
5. Store only hashed share tokens, return the raw token once, and rate-limit public reads.
6. Add expiring, revocable, copy-controlled public share pages with no owner-data leakage.
7. Build/package the extension, run permission/security checks, verify, and commit.

## Task 5: Accessibility, million-note readiness, and open-release packaging

**Files:**

- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `scripts/seed-performance.mjs`
- Modify: `scripts/benchmark-notes.mjs`
- Create: `scripts/check-release-config.mjs`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`
- Modify: `README.md`
- Modify: `docs/installation.md`
- Modify: `docs/configuration.md`

**Steps:**

1. Add keyboard, focus, dialog, live-region, reduced-motion, 360/390/768/1280/1440, and screen-reader-oriented checks.
2. Run the one-million-note tier on a disposable production-like database, or record the exact external-host command and disk prerequisite if local capacity is insufficient.
3. Validate configurable origins, provider settings, secrets, migrations, backup status, and extension packaging before release.
4. Add semantic versioning, changelog, issue/PR templates, generic self-host defaults, and license decision placeholder without inventing a license.
5. Run all tests, builds, audits, migration replay, Docker build, visual comparison, and smoke tests.
6. Push GitHub, verify CI, back up production, deploy an immutable image, verify core flows, and retain three exact rollback artifacts.

## Release acceptance

- Every new API is authenticated and owner-scoped unless explicitly public.
- Public shares reveal only opted-in note fields and use hashed, expiring, revocable tokens.
- Bulk and cleanup operations are bounded and transactional.
- Production backup is verified before deployment.
- Web, extension, import/export, PWA, search, sharing, accessibility, and rollback tests pass.
- Chrome Web Store submission remains excluded.
