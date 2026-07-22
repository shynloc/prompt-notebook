# Browser Capture and Scale Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Build a secure Chrome side-panel clipper that saves selected prompts and optional page artwork, while adding repeatable database capacity checks.

**Architecture:** Keep the Next.js modular monolith as the only API and data authority. Add PKCE-bound opaque device tokens, one transactional capture endpoint, and a separate WXT/React Manifest V3 package that injects a collector only after a user gesture.

**Tech Stack:** Next.js, React, TypeScript, PostgreSQL, Drizzle, Zod, Better Auth website sessions, Vite, Chrome Manifest V3, Vitest, Playwright.

---

### Task 1: Record architecture and release scope

**Files:** Create `docs/adr/0007-chrome-side-panel-extension.md`, `docs/adr/0008-extension-device-authorization.md`, `docs/adr/0009-capacity-and-search-readiness.md`, and `docs/phase-3-plan.md`.

**Steps:** Write the decisions, document alternatives and failure modes, run Markdown lint, then commit the documentation batch.

### Task 2: Add provenance and extension credential schema

**Files:** Modify `src/db/schema/notes.ts` and `src/db/schema/index.ts`; create `src/db/schema/extension.ts` and `src/db/migrations/0002_phase_3_extension.sql`; test in `tests/integration/db-schema.test.ts`.

**Steps:** Add failing ownership, uniqueness, cascade, and provenance tests; add the schema and migration; replay migrations twice; run the schema tests; commit.

### Task 3: Implement device-token primitives

**Files:** Create `src/modules/extension/extension-schema.ts`, `src/modules/extension/token-service.ts`, and `src/modules/extension/token-service.test.ts`; modify `src/lib/auth/session.ts`.

**Steps:** Test PKCE, expiry, one-time codes, refresh rotation, revocation, invalid Bearer tokens, and scope enforcement; implement the minimum service; run tests; commit.

### Task 4: Implement authorization routes and approval UI

**Files:** Create `src/app/extension/connect/page.tsx`, `src/components/extension/extension-connect.tsx`, four routes under `src/app/api/v1/extension/`, and `tests/integration/extension-auth.test.ts`.

**Steps:** Write the exchange and replay tests; implement signed-in approval, code exchange, refresh, and revoke; test accessibility and redirect validation; commit.

### Task 5: Add transactional capture API

**Files:** Create `src/modules/extension/capture-schema.ts`, `src/modules/extension/capture-service.ts`, tag and capture routes; modify note schema and repository; create `tests/integration/extension-capture.test.ts`.

**Steps:** Test a source-bearing text capture, tag isolation, image import degradation, and duplicate idempotency; implement; run the integration tests; commit.

### Task 6: Add device management and provenance UI

**Files:** Create `src/components/extension/device-manager.tsx` and device routes; modify `src/app/profile/page.tsx`, note types, lightbox, and editor.

**Steps:** Test user-scoped listing/revocation and safe source links; implement the UI; run component and integration tests; visually inspect desktop and mobile; commit.

### Task 7: Scaffold the Manifest V3 extension

**Files:** Create `apps/extension/package.json`, `vite.config.ts`, background and side-panel entrypoints; modify root scripts.

**Steps:** Install locked dependencies; build an unpacked extension; inspect the generated manifest for only approved permissions; commit.

### Task 8: Implement selection and image extraction

**Files:** Create `apps/extension/lib/page-collector.ts`, its tests, and typed messages.

**Steps:** Test title fallback, selected text, nearest-container scoring, icon/avatar rejection, OG fallback, deduplication, and the eight-image limit; implement; run tests; commit.

### Task 9: Implement extension authorization and API client

**Files:** Create `apps/extension/lib/auth.ts`, `api.ts`, `storage.ts`, and tests.

**Steps:** Test PKCE/state verification, token refresh, one retry, logout, and local-only storage; implement; run tests; commit.

### Task 10: Build the side-panel editor

**Files:** Create `apps/extension/entrypoints/sidepanel/App.tsx`, `style.css`, image candidates, and component tests.

**Steps:** Test edit, tag, image choice, save, retry, source display, draft restore, and keyboard access; implement the notebook visual language; capture and review screenshots; commit.

### Task 11: Add capacity fixtures and reporting

**Files:** Create `scripts/seed-performance.mjs`, `scripts/benchmark-notes.mjs`, and `docs/performance.md`; modify root scripts.

**Steps:** Generate deterministic batches; time list/search/tag queries; emit p50/p95/p99; clean only the named benchmark owner; run a safe small local benchmark; commit.

### Task 12: Complete release gates

**Files:** Add an extension connection E2E test; update CI, README, and release documentation.

**Steps:** Run type checking, lint, web and extension tests, both production builds, Playwright, migration replay, permission audit, dependency audit, and package smoke tests. Push, build, back up PostgreSQL, deploy, verify production health and capture flow, and retain rollback artifacts.
