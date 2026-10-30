# PR #3 Stabilization and Image API Compatibility Implementation Plan

> **Execution:** Use the Code planning/verification workflow and parallel scoped implementation, followed by an independent review before merging.

**Goal:** Preserve PR #3's module-boundary improvements while fixing upgrade regressions and OpenAI image-request compatibility, then release only after all gates pass.

**Architecture:** Keep the existing server-owned generation-to-note boundary and reuse the established `imagehub-note:<jobId>` idempotency namespace across both entry points. Keep model capabilities separate from transport-specific legacy response options; unknown image models must not automatically inherit retired DALL-E parameters. Preserve configured models, credentials, providers, storage and authorization.

**Tech Stack:** Next.js 16.4.3 App Router, TypeScript, PostgreSQL/Drizzle, BullMQ, Vitest, Playwright, Docker.

## Task 1: Restore generation-note compatibility

Files: `src/modules/generation/generation-service.ts`, `src/app/api/v1/generations/[id]/note/route.ts`, `tests/integration/generation-note-api.test.ts`.

1. Add a failing database regression: an existing legacy-key save must replay through the new endpoint instead of creating a second note.
2. Reuse the legacy namespace without a database migration. Preserve changed-title/removed-character replay semantics.
3. Make route service construction lazy, consistent with other generation routes, so unauthorized requests and module import do not require Redis.
4. Test authentication, ownership, incomplete jobs, persisted result assets/metadata, concurrent/repeated saves, legacy/new entry-point replay and deleted-character recovery. Use synthetic fixtures and local PostgreSQL only.

## Task 2: Repair limiter expiration

Files: `src/modules/ai/fixed-window-rate-limiter.ts`, `src/modules/ai/fixed-window-rate-limiter.test.ts`.

1. Add a failing regression for more than 10,000 single-request user buckets followed by an expired window and a new user.
2. Sweep expired buckets before early-return branches, keeping per-user quotas and window boundaries unchanged.
3. Test isolation, rejection, reset and preservation of active buckets during a sweep.

## Task 3: Correct image request contracts

Files: `src/modules/ai/image-capabilities.ts`, its tests, `src/modules/ai/providers/openai-compatible.ts` and its tests.

1. Add mocked failures for `chatgpt-image-latest` and unknown model IDs receiving `response_format`.
2. Recognize the documented ChatGPT image alias without rewriting its configured ID or claiming GPT Image 2.5/4K capabilities.
3. Make legacy response-format support explicit instead of inferring it from compression support. Do not automatically attach it to unknown providers/models.
4. Ensure the exact official OpenAI host does not receive retired image parameters in JSON generation or multipart editing. Retain explicit third-party legacy compatibility where applicable.
5. Do not auto-retry a submitted image request or alter saved model configuration or credentials.

Primary references, verified 2026-10-30:

- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/docs/models/chatgpt-image-latest

## Task 4: Complete browser and version regressions

Files: `tests/e2e/imagehub.spec.ts`, `tests/integration/note-version-restore.test.ts`.

1. Replace the obsolete save mock with an exact new-endpoint POST mock, verify the request payload, feedback and duplicate-click prevention.
2. Cover explicit retry without a deleted AI Model association.
3. Verify real database restore hashes, positive/negative prompt restoration, duplicate detection, 50-version retention, ownership and version conflicts.
4. Run browser tests using locally installed dependencies, not an external node_modules junction that Turbopack cannot resolve within its hermetic root.

## Task 5: Audit, release and deployment

1. Run typecheck, lint, all application/database tests, extension tests, worker/Next builds, documentation/release checks, complete browser tests and production dependency audit.
2. Independently review the final diff for ownership, idempotency, request-parameter and deployment regressions. Repair findings and rerun affected gates.
3. Publish fixes with a noreply Git identity; update PR #3 when maintainer push is available, otherwise merge the preserved contributor commit and fixes through a maintainer integration PR. Never force-push contributor history.
4. Require successful CI for the exact final head. Before merging to the auto-deployed branch, pause the update timer, verify a private backup and check active generation tasks.
5. Release v1.9.2, deploy the tested merge revision using the established rollback-capable updater, verify matching web/worker images, public health/readiness and unchanged configuration. Restore the update timer even if deployment fails.

No real model API calls, plaintext credential reads, configuration replacement or production test-account creation are part of verification.
