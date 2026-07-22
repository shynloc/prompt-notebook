# Usability and Reliability Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Prompt Notebook trustworthy for daily use, easier to organize at scale, portable between installations, and safer to operate and self-host.

**Architecture:** Extend the existing Next.js modular monolith and PostgreSQL schema without introducing new always-on services. IndexedDB protects editor drafts locally; PostgreSQL remains authoritative for saved notes. Existing note status fields power new gallery views, while import/export uses a versioned JSON contract.

**Tech Stack:** Next.js, React, TypeScript, IndexedDB, PostgreSQL, Drizzle, Zod, Better Auth, Vitest, Playwright, Docker Compose, Chrome Manifest V3.

---

## Implementation tasks

### Task 1: Fix truthful client state and hydration

**Files:**

- Create: `src/modules/sync/local-drafts.ts`
- Create: `src/modules/sync/local-drafts.test.ts`
- Create: `src/modules/sync/use-local-draft.ts`
- Modify: `src/components/editor/prompt-editor.tsx`
- Modify: `src/components/ui/sync-status.tsx`
- Modify: `src/components/notes/note-gallery.tsx`
- Test: `tests/e2e/offline-draft.spec.ts`

**Steps:**

1. Write failing IndexedDB serialization, versioning, expiry, and recovery tests.
2. Initialize gallery search from an effect instead of reading `window` during render.
3. Persist the editor payload after a short debounce and expose truthful state labels.
4. Offer restore/discard when a recoverable draft exists; clear it after cloud save.
5. Test offline refresh and recovered content in Chromium.
6. Run unit, type, and focused E2E tests; commit.

### Task 2: Add organization views and actions

**Files:**

- Modify: `src/modules/notes/note-schema.ts`
- Modify: `src/modules/notes/note-repository.ts`
- Modify: `src/modules/notes/note-service.ts`
- Modify: `src/app/api/v1/notes/route.ts`
- Modify: `src/components/notes/note-gallery.tsx`
- Modify: `src/components/notes/note-card.tsx`
- Modify: `src/components/notes/note-lightbox.tsx`
- Modify: `src/components/app-shell/desktop-sidebar.tsx`
- Modify: `src/components/app-shell/mobile-nav.tsx`
- Create: `src/app/favorites/page.tsx`
- Create: `src/app/archive/page.tsx`
- Create: `src/app/trash/page.tsx`
- Test: `tests/integration/notes-api.test.ts`
- Test: `tests/e2e/organization.spec.ts`

**Steps:**

1. Add failing API tests for active/favorite/archive/trash isolation and sort behavior.
2. Extend list validation and owner-scoped SQL conditions.
3. Add favorite/archive mutations with optimistic UI and rollback on failure.
4. Add routes, filters, empty states, and navigation.
5. Verify desktop/mobile card actions and trash restore; commit.

### Task 3: Add safe export and import

**Files:**

- Create: `src/modules/import/data-schema.ts`
- Create: `src/modules/import/import-service.ts`
- Create: `src/app/api/v1/export/route.ts`
- Create: `src/app/api/v1/import/preview/route.ts`
- Create: `src/app/api/v1/import/route.ts`
- Create: `src/components/settings/data-manager.tsx`
- Modify: `src/app/profile/page.tsx`
- Test: `tests/integration/import-export.test.ts`

**Steps:**

1. Define `prompt-notebook.export.v1` with strict size and record limits.
2. Test cross-user isolation, malformed input, duplicate IDs/content, preview-without-write, and replay.
3. Export notes, tags, terms, parameters, provenance, and image references.
4. Preview and import in bounded transactions using a stable digest.
5. Add download/upload UI with explicit result counts; commit.

### Task 4: Improve first use and mobile editing

**Files:**

- Modify: `src/components/notes/note-gallery.tsx`
- Modify: `src/components/editor/prompt-editor.tsx`
- Modify: `src/components/terms/term-library.tsx`
- Modify: `src/components/notes/note-preview.css`
- Modify: `src/components/app-shell/app-shell.css`
- Test: `tests/e2e/responsive-shell.spec.ts`

**Steps:**

1. Replace the signed-out gallery wall with one clear sign-in/register explanation.
2. Remove duplicate create CTAs at narrow widths.
3. Add vocabulary loading and request-error states.
4. Make editor actions sticky above mobile navigation with safe-area padding.
5. Verify 360/390/768/1280 px screenshots and keyboard save; commit.

### Task 5: Complete PWA and accessibility gates

**Files:**

- Create: `public/sw.js`
- Create: `src/components/pwa/service-worker-registration.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/manifest.ts`
- Test: `tests/e2e/accessibility.spec.ts`
- Test: `tests/e2e/pwa.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Steps:**

1. Add runtime caching for same-origin static GET requests and navigations; never cache `/api`, auth, or extension authorization responses.
2. Register only in production and expose the existing offline page.
3. Add manifest icons and install metadata.
4. Add axe-oriented semantic checks plus keyboard and reduced-motion tests.
5. Run install/offline smoke tests; commit.

### Task 6: Add operations and self-hosting completeness

**Files:**

- Create: `scripts/backup-postgres.sh`
- Create: `scripts/restore-postgres.sh`
- Create: `scripts/retain-releases.sh`
- Create: `scripts/smoke-production.mjs`
- Create: `deploy/compose.production.yml`
- Create: `.github/workflows/deploy.yml`
- Create: `docs/installation.md`
- Create: `docs/configuration.md`
- Create: `docs/backup-and-restore.md`
- Create: `docs/storage-providers.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Modify: `README.md`

**Steps:**

1. Make backup output private, checksummed, and failure-safe.
2. Require restore confirmation and refuse the live database by default.
3. Keep explicit current/rollback image tags; dry-run retention before deletion.
4. Document clean installation, configuration, upgrade, images, extension packaging, and known privacy limits.
5. Add manual deployment workflow inputs without committing secrets.
6. Run the production smoke script against the deployed domain; commit.

### Task 7: Capacity and full release gate

**Files:**

- Modify: `scripts/benchmark-notes.mjs`
- Modify: `docs/performance.md`
- Modify: `README.md`

**Steps:**

1. Add tag and API-oriented benchmark cases.
2. Run 100k notes on the disposable local database and record p50/p95/p99.
3. Leave 1m for a production-like disposable host with an explicit command and disk estimate.
4. Run lint, typecheck, all unit/integration/E2E/extension tests, both builds, dependency audit, migration replay, Docker build, and visual comparison.
5. Package the Chrome extension ZIP, push GitHub, deploy with a fresh backup, verify health and core flows, then remove only explicitly superseded Prompt Notebook artifacts.
