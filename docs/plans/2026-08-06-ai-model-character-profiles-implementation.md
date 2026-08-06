# AI Model Character Profiles Implementation Plan

**Goal:** Add user-owned AI character profiles that connect reusable reference images to prompt notes and durable ImageHub generation jobs.

**Architecture:** Implement a `characters` module within the existing Next.js modular monolith. Store relational metadata in PostgreSQL, keep image bytes in user-configured storage, and convert selected character images into immutable generation reference snapshots before queueing.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, PostgreSQL, BullMQ/Redis, Vitest, Testing Library and Playwright.

## Delivery checklist (1-18)

1. Freeze product terminology and the方案 B module boundary.
2. Record the architecture decision and future方案 C identity-adapter boundary.
3. Add owner-scoped profile, image, note-link and generation-provenance tables.
4. Add forward-only migrations, ownership constraints and growth indexes.
5. Validate bounded role cards, image metadata and ordered note associations.
6. Implement the repository/service layer with optimistic concurrency.
7. Expose authenticated, owner-isolated list/create/read/update APIs.
8. Implement archive, trash, restore and guarded permanent deletion.
9. Build the responsive AI Model asset library with search and pagination.
10. Build create/edit flows with upload, URL import and image-library reuse.
11. Implement cover, primary image, ordering, view labels and focal points.
12. Build Profile pages, contact sheets, usage metrics and linked-note waterfalls.
13. Add prompt-editor associations, local-draft retention and card/lightbox badges.
14. Add the ImageHub casting table and combined four-reference selection limit.
15. Snapshot selected character media and provenance into durable generation jobs.
16. Extend export/import to format v2 with v1 compatibility and resumable lifecycle handling.
17. Complete responsive, accessibility, security, concurrency and regression audits.
18. Publish version 1.5.0, push GitHub and verify the production deployment.

---

### Task 1: Freeze architecture and terminology

**Files:**
- Create: `docs/plans/2026-08-06-ai-model-character-profiles-design.md`
- Create: `docs/adr/0018-ai-model-character-assets.md`
- Modify: `docs/adr/README.md`

Document the UI/code naming boundary, one-character generation scope, many-to-many note relations, storage policy and future identity-adapter extension points.

### Task 2: Add owner-scoped character schema

**Files:**
- Create: `src/db/schema/characters.ts`
- Modify: `src/db/schema/index.ts`
- Create: generated migration under `src/db/migrations/`
- Test: `tests/integration/character-profiles.test.ts`

Write failing schema/ownership tests, add profiles, images, note joins and generation provenance, generate migration, migrate the test database and make tests pass.

### Task 3: Build validation, repository and service

**Files:**
- Create: `src/modules/characters/character-schema.ts`
- Create: `src/modules/characters/character-repository.ts`
- Create: `src/modules/characters/character-service.ts`
- Test: `src/modules/characters/character-schema.test.ts`
- Test: `tests/integration/character-profiles.test.ts`

Validate bounded role-card fields and image metadata; batch hydrate images and note counts; implement optimistic updates, archive/restore and guarded permanent deletion.

### Task 4: Expose authenticated character APIs

**Files:**
- Create: `src/app/api/v1/ai-models/route.ts`
- Create: `src/app/api/v1/ai-models/[id]/route.ts`
- Test: `tests/integration/character-profiles.test.ts`

Add paginated list/create/get/update/archive/delete handlers with session and owner checks. Verify malformed IDs, unauthenticated calls and cross-owner access fail securely.

### Task 5: Build reusable character UI primitives

**Files:**
- Create: `src/components/characters/types.ts`
- Create: `src/components/characters/character-picker.tsx`
- Create: `src/components/characters/character-badges.tsx`
- Create: `src/components/characters/character-profiles.css`
- Test: `src/components/characters/character-picker.test.tsx`

Implement accessible selection, thumbnails, active/archived states, loading/error feedback and responsive behavior.

### Task 6: Build asset library and editor

**Files:**
- Create: `src/components/characters/character-library.tsx`
- Create: `src/components/characters/character-editor.tsx`
- Create: `src/app/ai-models/page.tsx`
- Create: `src/app/ai-models/new/page.tsx`
- Create: `src/app/ai-models/[id]/edit/page.tsx`
- Modify: desktop and mobile navigation components

Reuse the configured upload/import/library API, enforce 12 images, support reorder, main/cover selection, view labels and clear save feedback.

### Task 7: Build the profile page and linked-note waterfall

**Files:**
- Create: `src/components/characters/character-profile-view.tsx`
- Create: `src/app/ai-models/[id]/page.tsx`
- Modify: `src/components/notes/note-gallery.tsx`
- Modify: note list schema, route and repository

Add `characterProfileId` filtering, usage summary, image gallery and a reused `NoteGallery` section.

### Task 8: Bind characters to notes

**Files:**
- Modify: notes schema, repository and view types
- Modify: `src/components/editor/prompt-editor.tsx`
- Modify: note card/lightbox components
- Modify: local draft schema
- Test: note API and editor/component tests

Persist ordered primary/supporting/reference relations, include them in hydration, render badges and preserve selections in local drafts.

### Task 9: Integrate ImageHub references

**Files:**
- Modify: generation schema, API, service and types
- Modify: `src/components/imagehub/imagehub-workbench.tsx`
- Create: `src/components/characters/generation-character-picker.tsx`
- Test: generation integration and ImageHub component tests

Submit profile/image IDs, validate ownership, securely read selected stored images, snapshot them through the existing media store and include provenance in returned jobs. Automatically bind a saved result note.

### Task 10: Extend transfer and lifecycle behavior

**Files:**
- Modify: `src/modules/transfer/notebook-transfer.ts`
- Test: `tests/integration/transfer-api.test.ts`

Version the portable format compatibly, export profiles before notes, deterministically remap colliding IDs, restore note bindings and retain version-1 import support.

### Task 11: Complete quality and security verification

**Files:**
- Add/modify unit, integration and E2E specifications
- Update README and changelog/release metadata

Run `npm run lint`, `npm run typecheck`, `npm test -- --run`, extension tests/build, production build, full Playwright, `npm audit --omit=dev`, migration validation and focused OWASP review. Fix all critical/high findings and all feature regressions before release.

### Task 12: Release and deploy

Update the patch/minor version, commit intentionally, push `public-main:main`, wait for CI, tag the release, verify artifacts, allow the guarded production updater to deploy, then confirm commit/image identity, health endpoints, logs and live desktop/mobile flows.
