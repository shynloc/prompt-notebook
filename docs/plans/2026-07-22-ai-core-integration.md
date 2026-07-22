# AI Core Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add secure multi-model AI configuration, safe prompt optimization, and a professional asynchronous AI ImageHub to Prompt Notebook without sharing ACKS Image Web runtime state.

**Architecture:** Keep the Next.js modular monolith for authenticated configuration and short AI requests. Add owner-scoped PostgreSQL tables, versioned AES-256-GCM secret encryption, capability-oriented provider adapters, and later an isolated Redis/BullMQ generation worker whose results are stored only through `StorageProvider`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Better Auth, PostgreSQL 16, Drizzle ORM, Zod, Node.js crypto, Redis/BullMQ, Vitest, Playwright, Docker Compose.

---

## Task 1: Record architecture and contracts

**Files:**

- Create: `docs/plans/2026-07-22-ai-core-integration-design.md`
- Create: `docs/adr/0010-user-owned-encrypted-ai-connections.md`
- Create: `docs/adr/0011-ai-provider-adapter.md`
- Create: `docs/adr/0012-isolated-generation-queue.md`
- Create: `docs/adr/0013-object-storage-only-generation-assets.md`
- Create: `docs/adr/0014-rebuild-aihub-capabilities-without-runtime-sharing.md`
- Modify: `docs/adr/README.md`

**Steps:**

1. Record product scope, data flow, security boundary, failure model, and acceptance criteria.
2. Record all five accepted decisions and rejected alternatives.
3. Check links and ensure the design does not require ACKS Image Web or WordPress.
4. Commit the documentation batch.

## Task 2: Add owner-scoped AI configuration schema

**Files:**

- Create: `src/db/schema/ai.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/migrations/0007_*.sql`
- Modify: `src/db/migrations/meta/_journal.json`
- Test: `tests/integration/ai-configuration.test.ts`

**Steps:**

1. Write failing schema tests for ownership, uniqueness, cascading deletion, and per-purpose preferences.
2. Add provider connections, model profiles, and user preferences with owner-prefixed indexes and composite ownership constraints.
3. Generate the Drizzle migration.
4. Replay migrations on the disposable test database and run the failing tests to confirm the expected boundary.
5. Commit the schema batch.

## Task 3: Add encryption and outbound URL policy

**Files:**

- Create: `src/modules/ai/credential-crypto.ts`
- Create: `src/modules/ai/outbound-url-policy.ts`
- Test: `src/modules/ai/credential-crypto.test.ts`
- Test: `src/modules/ai/outbound-url-policy.test.ts`
- Modify: `docs/configuration.md`

**Steps:**

1. Write failing tests for round trips, wrong AAD, key versions, invalid keys, HTTPS enforcement, credentials in URLs, localhost, private IPs, and unsafe DNS results.
2. Implement AES-256-GCM with random IV and versioned key-ring parsing.
3. Implement URL syntax checks and injectable DNS verification so tests never use the network.
4. Document secret generation, rotation, backup, and recovery.
5. Run focused tests and commit.

## Task 4: Add provider registry and OpenAI-compatible adapter

**Files:**

- Create: `src/modules/ai/types.ts`
- Create: `src/modules/ai/provider-registry.ts`
- Create: `src/modules/ai/providers/openai-compatible.ts`
- Test: `src/modules/ai/providers/openai-compatible.test.ts`

**Steps:**

1. Write failing tests for connection checks, stable error mapping, timeouts, malformed bodies, and no secret leakage.
2. Define capability-oriented interfaces and stable error codes.
3. Implement the adapter with bounded response parsing and an injectable fetch implementation.
4. Revalidate the outbound URL immediately before the request.
5. Run focused tests and commit.

## Task 5: Add AI configuration service and API

**Files:**

- Create: `src/modules/ai/ai-configuration-schema.ts`
- Create: `src/modules/ai/ai-configuration-service.ts`
- Create: `src/app/api/v1/ai/configurations/route.ts`
- Create: `src/app/api/v1/ai/configurations/[id]/route.ts`
- Create: `src/app/api/v1/ai/configurations/[id]/test/route.ts`
- Create: `src/app/api/v1/ai/preferences/route.ts`
- Test: `tests/integration/ai-configuration.test.ts`

**Steps:**

1. Write failing API tests for authentication, cross-user isolation, create/list/update/delete, masked responses, connection tests, and capability-compatible preference assignment.
2. Implement Zod inputs with bounded strings, capabilities, and model defaults.
3. Encrypt new or replaced secrets and never select encrypted fields for list responses.
4. Validate connection ownership in every model and preference mutation.
5. Add capability-specific tests that require an explicit user action because they may incur provider cost.
6. Run integration tests and commit.

## Task 6: Build the AI assistant configuration page

**Files:**

- Create: `src/app/settings/ai/page.tsx`
- Create: `src/components/ai/ai-configuration-manager.tsx`
- Create: `src/components/ai/ai-settings.css`
- Modify: `src/components/app-shell/desktop-sidebar.tsx`
- Modify: `src/components/app-shell/mobile-nav.tsx`
- Test: `src/components/ai/ai-configuration-manager.test.tsx`
- Test: `tests/e2e/ai-configuration.spec.ts`

**Steps:**

1. Write failing component tests for multiple cards, masked keys, purpose changes, validation, and destructive confirmation.
2. Build the responsive settings page using existing paper, stamp, typography, spacing, focus, and reduced-motion tokens.
3. Add test, edit, copy, enable/disable, and delete controls without exposing stored secrets.
4. Add desktop navigation and a mobile-accessible account/settings entry.
5. Run component, accessibility, and responsive tests; commit.

## Task 7: Add confirm-before-apply prompt optimization

**Files:**

- Create: `src/modules/ai/prompt-optimizer.ts`
- Create: `src/app/api/v1/ai/optimize/route.ts`
- Create: `src/components/ai/prompt-optimization-dialog.tsx`
- Modify: `src/components/editor/prompt-editor.tsx`
- Test: `src/components/ai/prompt-optimization-dialog.test.tsx`
- Test: `tests/integration/ai-optimization.test.ts`
- Test: `tests/e2e/ai-optimization.spec.ts`

**Steps:**

1. Write failing tests proving discard leaves the original unchanged and stale responses cannot overwrite newer edits.
2. Implement the general optimizer system instruction and selected-profile lookup.
3. Add timeout, abort, rate-limit, bounded input, and stable error handling.
4. Add loading status, original/result comparison, copy, accept, discard, and undo.
5. Verify create/edit, keyboard, screen-reader, and mobile flows; commit.

## Task 8: Add durable generation infrastructure

**Files:**

- Extend: `src/db/schema/ai.ts`
- Create: `src/modules/generation/*`
- Create: `scripts/generation-worker.ts`
- Modify: `package.json`
- Modify: `deploy/compose.production.yml`
- Test: `tests/integration/generation-jobs.test.ts`

**Steps:**

1. Write failing tests for ownership, idempotency, concurrency, retries, cancellation, stale recovery, and storage-only success.
2. Add generation jobs/assets and their indexes.
3. Add an isolated queue and worker with production concurrency one.
4. Port size/quality mapping behind the image provider adapter.
5. Upload reference assets before enqueueing; store no base64 in PostgreSQL or Redis.
6. Refuse production local-disk fallback and commit.

## Task 9: Build AI ImageHub and note integration

**Files:**

- Create: `src/app/imagehub/page.tsx`
- Create: `src/components/imagehub/*`
- Create: `src/app/api/v1/generations/route.ts`
- Create: `src/app/api/v1/generations/[id]/route.ts`
- Create: `src/app/api/v1/ai/reverse-prompt/route.ts`
- Modify: `src/components/notes/note-lightbox.tsx`
- Modify: `src/components/editor/prompt-editor.tsx`
- Test: `tests/e2e/imagehub.spec.ts`

**Steps:**

1. Write failing end-to-end tests for note prefill, text/image generation, reverse prompting, refresh recovery, cancellation, history, download, save-as-note, and attach-as-cover.
2. Build the responsive workbench and mobile sticky action using existing design tokens.
3. Poll durable status with bounded backoff and restore active jobs on load.
4. Add confirm-before-apply reverse prompting and image-specific optimization.
5. Attach successful objects through the existing note image model and commit.

## Task 10: Harden, document, package, and deploy

**Files:**

- Modify: `docs/configuration.md`
- Modify: `docs/installation.md`
- Modify: `docs/backup-and-restore.md`
- Modify: `README.md`
- Modify: `scripts/check-release-config.mjs`
- Modify: `scripts/smoke-production.mjs`

**Steps:**

1. Add quotas, rate limits, redacted telemetry, queue metrics, orphan cleanup, and temporary-object lifecycle documentation.
2. Run unit, integration, extension, Playwright, type, lint, build, dependency audit, migration replay, and Docker checks.
3. Back up PostgreSQL and the encryption key ring independently.
4. Deploy an immutable commit image, run migrations, start the queue and worker, and verify public and authenticated smoke flows.
5. Keep ACKS Image Web unchanged and retain exact Prompt Notebook rollback artifacts until acceptance.

## Release acceptance

- AI credentials are encrypted, owner-scoped, masked, and excluded from exports and logs.
- Unsafe custom base URLs cannot reach local, private, link-local, or metadata endpoints.
- Separate active models can be selected for optimization, generation, and reverse prompting.
- AI results never overwrite editor content without explicit confirmation.
- Image jobs are durable, bounded, retryable, cancellable, and independent of the web process.
- Reference and generated images use `StorageProvider`; production stores no generated files locally.
- Desktop and mobile flows pass accessibility and end-to-end checks.
- Prompt Notebook remains independent of WordPress and ACKS Image Web.
