# Prompt Notebook Web App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从零构建一个运行于 `prompts.example.com` 的独立、响应式、可跨设备同步的提示词作品库，并支持可靠草稿、真实认证和可替换图床。

**Architecture:** 使用 Next.js 模块化单体提供 UI、同源 API 和认证，PostgreSQL 是云端事实来源，IndexedDB 保存游客数据与离线 outbox。图片经 `StorageProvider` 接口写入现有图床或 S3-compatible 存储，生产使用 Docker Compose、宿主机 Nginx 和 Cloudflare。

**Tech Stack:** Next.js、React、TypeScript、Tailwind CSS、Radix primitives、PostgreSQL 16、Drizzle ORM、Better Auth、Zod、IndexedDB、Sharp、Vitest、Testing Library、Playwright、Docker Compose。

---

## 0. 执行规则

- 当前 `prompt-notebook.html` 是参考 Demo，不在新应用中导入或逐步改写。
- 每个任务从失败测试开始，测试通过后再提交。
- 不跨任务顺手实现未来功能；遵守 MVP 非目标。
- 数据库模式变更必须生成迁移并验证从空库执行。
- 所有用户资源查询必须包含当前会话 `userId`。
- 图床 Token、认证 Secret、SMTP 密码不得进入客户端 bundle、日志或 Git。
- 每个阶段结束执行 `npm run lint && npm run typecheck && npm test && npm run test:e2e`。

## 1. 阶段总览

| 阶段 | 结果 | 阶段门 |
|---|---|---|
| Phase 0 | 工程骨架与质量门 | CI 可重复构建，测试框架运行 |
| Phase 1 | 真实账户和云端笔记 | 两个用户的数据严格隔离 |
| Phase 2 | 桌面/移动核心体验 | 新建、编辑、搜索、复制、收藏完整可用 |
| Phase 3 | 图片作品与图床 | 图片失败不影响文本，服务器不持久落图 |
| Phase 4 | 本地优先与迁移 | 刷新/断网不丢输入，旧数据可预览合并 |
| Phase 5 | 生产部署与开源包装 | 域名可用、备份可恢复、安装文档可复现 |

## Phase 0：工程骨架

### Task 1：创建 Next.js 与测试骨架

**Files:**

- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/test/setup.ts`
- Create: `tests/e2e/smoke.spec.ts`
- Create: `.github/workflows/ci.yml`

**Step 1: Scaffold in a temporary directory**

Run:

```bash
npx create-next-app@latest prompt-notebook-scaffold --ts --eslint --tailwind --app --src-dir --import-alias '@/*'
```

Expected: a current Next.js App Router project without interactive errors. Copy only generated project files into the repository; do not overwrite `docs/` or the Demo.

**Step 2: Write the failing smoke test**

```ts
import { expect, test } from "@playwright/test";

test("opens the notebook shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Prompt Notebook" })).toBeVisible();
});
```

**Step 3: Run the smoke test**

Run: `npm run test:e2e -- tests/e2e/smoke.spec.ts`
Expected: FAIL because the final shell heading does not exist or the test setup is incomplete.

**Step 4: Implement the minimal app shell and scripts**

Add scripts for `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch` and `test:e2e`. Render the product heading in `src/app/page.tsx`.

**Step 5: Verify all quality commands**

Run:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e -- tests/e2e/smoke.spec.ts
```

Expected: all PASS.

**Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json src vitest.config.ts playwright.config.ts tests .github
git commit -m "chore: scaffold prompt notebook app"
```

### Task 2：建立视觉 Token 与响应式应用框架

**Files:**

- Create: `src/styles/tokens.css`
- Create: `src/components/app-shell/app-shell.tsx`
- Create: `src/components/app-shell/desktop-sidebar.tsx`
- Create: `src/components/app-shell/mobile-nav.tsx`
- Create: `src/components/ui/sync-status.tsx`
- Test: `src/components/app-shell/app-shell.test.tsx`
- Test: `tests/e2e/responsive-shell.spec.ts`

**Step 1: Write component tests**

Test that desktop navigation includes All, Favorites, Recent and Library; test that mobile navigation includes Notes, Search, New, Library and Profile with accessible labels.

**Step 2: Run the tests**

Run: `npm test -- src/components/app-shell/app-shell.test.tsx --run`
Expected: FAIL because components do not exist.

**Step 3: Define tokens**

Define semantic variables for board, paper, ink, muted ink, stamp red, focus ring, shadows, spacing, radii, type families and motion. Include dark-mode-ready aliases without implementing the final dark theme.

**Step 4: Implement adaptive shell**

Use CSS media/container queries so desktop shows sidebar and top bar, while mobile shows top bar and bottom navigation. Do not rotate form surfaces.

**Step 5: Add responsive Playwright assertions**

At 1440x900 assert desktop sidebar visible and mobile nav hidden. At 390x844 assert mobile nav visible, sidebar hidden and no horizontal overflow.

**Step 6: Verify and commit**

Run: `npm test -- --run && npm run test:e2e -- tests/e2e/responsive-shell.spec.ts`
Expected: PASS.

```bash
git add src/styles src/components tests/e2e/responsive-shell.spec.ts
git commit -m "feat: add responsive application shell"
```

## Phase 1：真实账户和云端笔记

### Task 3：建立 PostgreSQL 模式与迁移

**Files:**

- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/schema/auth.ts`
- Create: `src/db/schema/notes.ts`
- Create: `src/db/schema/terms.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/migrations/*`
- Create: `tests/integration/db-schema.test.ts`
- Create: `docker-compose.dev.yml`
- Create: `.env.example`

**Step 1: Write schema integration tests**

Cover user ownership, note version default, one-cover-per-note rule, image ordering, tag uniqueness per user and cascade behavior. Use a disposable test database.

**Step 2: Run the test**

Run: `npm test -- tests/integration/db-schema.test.ts --run`
Expected: FAIL because schema and database helpers do not exist.

**Step 3: Implement schema**

Create auth tables required by Better Auth plus `prompt_notes`, `prompt_images`, `tags`, `note_tags`, `custom_terms`, `drafts` and `idempotency_keys`. Use UUID primary keys, `timestamptz`, explicit foreign keys and indexes documented in `docs/architecture.md`.

**Step 4: Generate and apply migration**

Run:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
npm run db:generate
npm run db:migrate
```

Expected: migration applies to an empty PostgreSQL 16 database.

**Step 5: Recreate the database and rerun**

Drop only the disposable development volume, recreate it, run migration and integration tests again. Expected: PASS from a clean database.

**Step 6: Commit**

```bash
git add drizzle.config.ts src/db tests/integration docker-compose.dev.yml .env.example package.json package-lock.json
git commit -m "feat: add prompt notebook database schema"
```

### Task 4：集成 Better Auth

**Files:**

- Create: `src/lib/auth/server.ts`
- Create: `src/lib/auth/client.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/app/(auth)/sign-in/page.tsx`
- Create: `src/app/(auth)/sign-up/page.tsx`
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/lib/email/mailer.ts`
- Test: `tests/integration/auth.test.ts`
- Test: `tests/e2e/auth.spec.ts`

**Step 1: Write failing auth tests**

Test registration, duplicate email rejection, password login, invalid password, logout, protected route rejection and cross-user session isolation.

**Step 2: Run the tests**

Run: `npm test -- tests/integration/auth.test.ts --run`
Expected: FAIL because auth handlers do not exist.

**Step 3: Configure Better Auth**

Enable email/password, verification and reset callbacks. Use Drizzle/PostgreSQL adapter and secure cookie configuration derived from `APP_URL`. Keep SMTP behind a `Mailer` interface with a development console implementation.

**Step 4: Build accessible auth screens**

Use labeled fields, autocomplete attributes, inline validation, generic credential errors and focus management. Do not disclose whether an email exists during password reset.

**Step 5: Verify browser flow**

Run: `npm run test:e2e -- tests/e2e/auth.spec.ts`
Expected: a user can sign up, sign in, refresh, remain signed in and sign out.

**Step 6: Commit**

```bash
git add src/lib/auth src/lib/email src/app/api/auth src/app/\(auth\) tests/integration/auth.test.ts tests/e2e/auth.spec.ts
git commit -m "feat: add independent user authentication"
```

### Task 5：实现笔记领域服务与 API

**Files:**

- Create: `src/modules/notes/note-schema.ts`
- Create: `src/modules/notes/note-repository.ts`
- Create: `src/modules/notes/note-service.ts`
- Create: `src/app/api/v1/notes/route.ts`
- Create: `src/app/api/v1/notes/[id]/route.ts`
- Create: `src/app/api/v1/notes/[id]/restore/route.ts`
- Create: `src/lib/api/errors.ts`
- Create: `src/lib/api/response.ts`
- Test: `tests/integration/notes-api.test.ts`

**Step 1: Write failing API tests**

Cover create, list with cursor, detail, patch with version, 409 conflict, soft delete, restore, validation errors, unauthenticated access and attempts to read or mutate another user's note.

**Step 2: Run tests**

Run: `npm test -- tests/integration/notes-api.test.ts --run`
Expected: FAIL with missing route/module errors.

**Step 3: Implement schemas and repository**

Use Zod at API boundaries. Repository methods receive `userId` as a mandatory argument; do not expose unscoped `findById(id)`.

**Step 4: Implement optimistic concurrency**

Update where `id`, `user_id` and `version` all match. Increment version atomically; return the current server representation on conflict.

**Step 5: Run tests and commit**

Run: `npm test -- tests/integration/notes-api.test.ts --run`
Expected: PASS.

```bash
git add src/modules/notes src/app/api/v1/notes src/lib/api tests/integration/notes-api.test.ts
git commit -m "feat: add user-scoped notes API"
```

## Phase 2：核心产品体验

### Task 6：实现作品库、搜索与筛选

**Files:**

- Create: `src/app/(app)/notes/page.tsx`
- Create: `src/components/notes/note-gallery.tsx`
- Create: `src/components/notes/note-card.tsx`
- Create: `src/components/notes/note-filters.tsx`
- Create: `src/modules/notes/note-queries.ts`
- Test: `src/components/notes/note-card.test.tsx`
- Test: `tests/e2e/notebook.spec.ts`

**Step 1: Write card and gallery tests**

Test image and text-only variants, accessible copy/favorite actions, stable image ratio, empty state and pagination sentinel.

**Step 2: Add API query tests**

Test search across title/prompt/model/tags and filters for favorite, archived, has-image and date. Verify every query is user-scoped.

**Step 3: Implement cursor pagination and filters**

Keep filter state in URL search parameters. List API returns only card fields and cover thumbnail, not full image sets.

**Step 4: Implement desktop and mobile gallery**

Use fixed-ratio responsive cards, lazy images and list virtualization only if measured performance requires it.

**Step 5: Verify and commit**

Run: `npm test -- --run && npm run test:e2e -- tests/e2e/notebook.spec.ts`
Expected: search, filters, copy and favorite pass on desktop and mobile viewports.

```bash
git add src/app/\(app\)/notes src/components/notes src/modules/notes tests
git commit -m "feat: add searchable visual notebook"
```

### Task 7：实现编辑器与词库

**Files:**

- Create: `src/app/(app)/notes/new/page.tsx`
- Create: `src/app/(app)/notes/[id]/page.tsx`
- Create: `src/components/editor/prompt-editor.tsx`
- Create: `src/components/editor/editor-toolbar.tsx`
- Create: `src/components/terms/term-library.tsx`
- Create: `src/modules/terms/built-in-terms.json`
- Create: `src/modules/terms/term-service.ts`
- Create: `src/app/api/v1/terms/route.ts`
- Create: `src/app/api/v1/terms/[id]/route.ts`
- Test: `src/components/editor/prompt-editor.test.tsx`
- Test: `tests/e2e/editor.spec.ts`

**Step 1: Write editor tests**

Test insertion at cursor, undo, copy success/failure, model and parameter editing, keyboard save, unsaved indicator and mobile bottom-sheet library.

**Step 2: Write term API tests**

Test create, edit, delete, duplicate handling and user isolation. Built-in terms are readable but not mutable.

**Step 3: Implement editor state**

Separate domain form state from persistence state. Do not show “saved” until IndexedDB or API confirms the relevant write.

**Step 4: Implement the term library**

Load built-in JSON plus current user's terms; support category, search, keyboard navigation and insertion while preserving focus and selection.

**Step 5: Verify and commit**

Run: `npm test -- --run && npm run test:e2e -- tests/e2e/editor.spec.ts`
Expected: core editing flow passes at 1440x900 and 390x844.

```bash
git add src/app/\(app\)/notes src/components/editor src/components/terms src/modules/terms src/app/api/v1/terms tests
git commit -m "feat: add prompt editor and reusable term library"
```

## Phase 3：图片作品与图床

### Task 8：建立 StorageProvider 与图床适配器

**Files:**

- Create: `src/modules/media/storage-provider.ts`
- Create: `src/modules/media/providers/picbed.ts`
- Create: `src/modules/media/providers/local.ts`
- Create: `src/modules/media/storage-factory.ts`
- Test: `src/modules/media/providers/picbed.test.ts`

**Step 1: Write contract tests**

Test successful upload normalization, nested URL response, inaccessible returned URL, authentication failure, timeout, delete behavior and absence of Token in thrown/logged errors.

**Step 2: Run tests**

Run: `npm test -- src/modules/media/providers/picbed.test.ts --run`
Expected: FAIL because provider does not exist.

**Step 3: Implement the interface and provider**

Use server-only modules. Send multipart `file` and `path`, attach `X-Auth-Token`, normalize returned values and verify the object is readable before committing metadata.

**Step 4: Add a local development provider**

Store under a configured development-only directory. Reject local provider when `NODE_ENV=production` unless explicitly enabled.

**Step 5: Verify and commit**

```bash
npm test -- src/modules/media --run
git add src/modules/media
git commit -m "feat: add pluggable image storage"
```

### Task 9：实现安全图片处理与上传

**Files:**

- Create: `src/modules/media/image-policy.ts`
- Create: `src/modules/media/image-processor.ts`
- Create: `src/modules/media/media-service.ts`
- Create: `src/app/api/v1/uploads/route.ts`
- Create: `src/components/media/image-uploader.tsx`
- Create: `src/components/media/image-gallery-editor.tsx`
- Test: `tests/integration/upload-api.test.ts`
- Test: `tests/e2e/image-upload.spec.ts`
- Fixture: `tests/fixtures/images/*`

**Step 1: Write upload security tests**

Cover valid JPEG/PNG/WebP, extension/MIME mismatch, SVG rejection, oversized bytes, oversized decoded pixels, corrupt data, unauthenticated request, user quota and provider failure.

**Step 2: Run tests**

Run: `npm test -- tests/integration/upload-api.test.ts --run`
Expected: FAIL.

**Step 3: Implement streaming policy and processing**

Limit request size at Nginx and application layers. Validate magic bytes, decode with Sharp limits, normalize orientation, create display and thumbnail variants and avoid persistent temporary files.

**Step 4: Implement resilient UI**

Show local object URL immediately. Track each image independently through queued, uploading, processing, complete and failed states. A failed image never prevents note text save.

**Step 5: Verify and commit**

Run: `npm test -- --run && npm run test:e2e -- tests/e2e/image-upload.spec.ts`
Expected: successful and failed upload journeys pass.

```bash
git add src/modules/media src/app/api/v1/uploads src/components/media tests
git commit -m "feat: add secure prompt artwork uploads"
```

## Phase 4：本地优先、同步和迁移

### Task 10：实现 IndexedDB 草稿与 outbox

**Files:**

- Create: `src/modules/sync/local-db.ts`
- Create: `src/modules/sync/outbox.ts`
- Create: `src/modules/sync/sync-engine.ts`
- Create: `src/modules/sync/use-sync-status.ts`
- Create: `src/modules/sync/broadcast.ts`
- Test: `src/modules/sync/sync-engine.test.ts`
- Test: `tests/e2e/offline-draft.spec.ts`

**Step 1: Write deterministic sync tests**

Use fake timers and mocked network. Cover local-first create, retry with backoff, idempotent replay, tab coordination, auth expiry, 409 pause and successful queue drain.

**Step 2: Run tests**

Run: `npm test -- src/modules/sync/sync-engine.test.ts --run`
Expected: FAIL.

**Step 3: Implement versioned IndexedDB schema**

Store drafts, cached notes, outbox operations and sync metadata. Add explicit migration functions for future schema versions.

**Step 4: Implement the sync engine**

Use client UUIDs and idempotency keys. Permit one active sync leader per browser profile where practical; other tabs receive status via BroadcastChannel.

**Step 5: Verify offline browser behavior**

Run: `npm run test:e2e -- tests/e2e/offline-draft.spec.ts`
Expected: type, go offline, refresh, recover text, reconnect and reach “synced”.

**Step 6: Commit**

```bash
git add src/modules/sync tests/e2e/offline-draft.spec.ts
git commit -m "feat: add local-first drafts and sync outbox"
```

### Task 11：实现旧 Demo 数据导入与导出

**Files:**

- Create: `src/modules/import/demo-v1-schema.ts`
- Create: `src/modules/import/import-service.ts`
- Create: `src/app/api/v1/sync/import-preview/route.ts`
- Create: `src/app/api/v1/sync/import/route.ts`
- Create: `src/app/api/v1/export/route.ts`
- Create: `src/components/settings/import-dialog.tsx`
- Test: `tests/integration/import.test.ts`
- Fixture: `tests/fixtures/import/demo-v1.json`

**Step 1: Write import tests**

Cover valid v1, malformed JSON, oversized files, invalid records, duplicate IDs, duplicate content, repeat submission, mixed success and transaction rollback.

**Step 2: Implement preview**

Return counts and sanitized sample rows for add, merge, conflict, skip and error. Preview must not write data.

**Step 3: Implement idempotent import**

Require a preview token or import ID, write in bounded batches and return a stable result if the client retries.

**Step 4: Implement export**

Export a documented versioned JSON schema containing notes, metadata, custom terms and image references, but never auth secrets.

**Step 5: Verify and commit**

```bash
npm test -- tests/integration/import.test.ts --run
git add src/modules/import src/app/api/v1/sync src/app/api/v1/export src/components/settings tests
git commit -m "feat: add safe data import and export"
```

## Phase 5：质量、生产和开源

### Task 12：完成无障碍、PWA 和性能预算

**Files:**

- Create: `src/app/manifest.ts`
- Create: `src/app/offline/page.tsx`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/performance.spec.ts`
- Modify: `src/app/layout.tsx`
- Modify: `.github/workflows/ci.yml`

**Step 1: Add automated accessibility tests**

Run axe against notebook, editor, auth and dialog states. Add keyboard-only tests for core flow and reduced-motion assertions.

**Step 2: Add performance budgets**

Fail CI when primary route has unexpected horizontal overflow, unbounded image requests or a chosen JavaScript budget regression. Record initial Lighthouse baselines rather than claiming synthetic values as production truth.

**Step 3: Add install metadata and offline fallback**

Provide manifest, icons, theme colors and a clear offline route. Do not cache authenticated API responses in a service worker.

**Step 4: Verify and commit**

```bash
npm run lint && npm run typecheck && npm test -- --run
npm run test:e2e -- tests/e2e/accessibility.spec.ts tests/e2e/performance.spec.ts
git add src/app tests/e2e .github/workflows/ci.yml
git commit -m "feat: add accessibility and performance gates"
```

### Task 13：建立生产容器、健康检查与部署

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `deploy/compose.production.yml`
- Create: `deploy/nginx/prompt-notebook.conf.example`
- Create: `src/app/health/live/route.ts`
- Create: `src/app/health/ready/route.ts`
- Create: `scripts/migrate.mjs`
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/restore-postgres.sh`
- Create: `.github/workflows/deploy.yml`
- Create: `tests/integration/health.test.ts`

**Step 1: Write health tests**

Test liveness without database dependency and readiness success/failure with database. Responses must not disclose connection strings or stack traces.

**Step 2: Build a standalone production image**

Use a multi-stage Dockerfile, non-root runtime user, fixed Node major version and Next.js standalone output.

**Step 3: Define production Compose**

Use dedicated network, PostgreSQL volume, health checks, restart policies and localhost-only app port binding. Do not expose PostgreSQL publicly.

**Step 4: Define Nginx configuration**

Proxy `prompts.example.com`, preserve trusted proxy headers, set upload size/timeouts, security headers and avoid caching authenticated responses.

**Step 5: Test container locally**

Run:

```bash
docker build -t prompt-notebook:test .
docker compose -f deploy/compose.production.yml config
docker compose -f deploy/compose.production.yml up -d
curl --fail http://127.0.0.1:${PROMPT_APP_PORT}/health/ready
```

Expected: image builds, Compose validates and readiness returns 200.

**Step 6: Test backup restoration against a disposable database**

Create data, back up, restore into a new disposable database and compare expected note counts and checksums. Expected: recovery succeeds without touching production data.

**Step 7: Commit**

```bash
git add Dockerfile .dockerignore deploy src/app/health scripts .github/workflows/deploy.yml tests/integration/health.test.ts
git commit -m "ops: add production deployment and recovery"
```

### Task 14：开源包装与发布检查

**Files:**

- Modify: `README.md`
- Create after the owner's explicit decision: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `docs/installation.md`
- Create: `docs/configuration.md`
- Create: `docs/backup-and-restore.md`
- Create: `docs/storage-providers.md`
- Create: `docs/privacy.md`
- Create: `scripts/smoke-production.mjs`

**Step 1: Choose the license before public release**

Record the owner's explicit choice. Do not assume MIT or AGPL. Until chosen, keep the repository private and omit a misleading license grant.

**Step 2: Write installation docs from a clean machine perspective**

Document required environment variables, SMTP-optional development mode, local storage driver and one-command Compose startup.

**Step 3: Write operational docs**

Document upgrades, migrations, backup retention, restore drill, storage privacy, account deletion and known limitations.

**Step 4: Run a clean-install smoke test**

Clone into a temporary directory, follow only README instructions, start the app, register a user, create a note, upload a fixture, restart containers and verify persistence.

**Step 5: Run the full release gate**

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
node scripts/smoke-production.mjs https://prompts.example.com
```

Expected: all checks PASS; no console errors in core journeys; production health and authenticated persistence verified.

**Step 6: Commit**

```bash
git add README.md LICENSE CONTRIBUTING.md SECURITY.md docs scripts/smoke-production.mjs
git commit -m "docs: prepare self-hosted distribution"
```

## 2. 阶段验收与停止条件

### Phase 0 Exit

- Clean checkout can install, test and build.
- Desktop and mobile app shell has no overflow and basic keyboard access.
- CI protects lint, type and test failures.

### Phase 1 Exit

- Registration, login, reset and logout are functional.
- Cross-user API tests prove strict data isolation.
- Database can be recreated entirely from migrations.

### Phase 2 Exit

- A user can create, edit, search, filter, copy, favorite, archive, delete and restore notes.
- Desktop and mobile core flows pass Playwright.
- UI shows truthful save/sync states.

### Phase 3 Exit

- Image types and limits are enforced server-side.
- Provider failure never loses prompt text.
- No picbed Token is present in browser assets or logs.
- App container does not retain uploaded originals on disk.

### Phase 4 Exit

- Offline refresh preserves draft.
- Reconnection drains outbox without duplicates.
- Conflicts are visible and never silently overwrite.
- Demo v1 import previews and merges safely.

### Phase 5 Exit

- `prompts.example.com` is healthy through Cloudflare and Nginx.
- Backup restore drill meets RPO/RTO assumptions or updates them with evidence.
- A new user can self-host from documentation without WordPress.
- Repository remains private until license, privacy behavior and image access policy are explicitly approved.

## 3. Recommended execution checkpoints

1. Review after Tasks 1-2: visual shell before domain code.
2. Review after Tasks 3-5: auth/data security before UI expansion.
3. Review after Tasks 6-7: desktop/mobile usability before image work.
4. Review after Tasks 8-9: image privacy and upload limits before production data.
5. Review after Tasks 10-11: offline and migration behavior with destructive tests.
6. Review after Tasks 12-14: production release and open-source readiness.
