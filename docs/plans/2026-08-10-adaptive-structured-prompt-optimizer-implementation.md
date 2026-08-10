# Adaptive Structured Prompt Optimizer Implementation Plan

**Goal:** Upgrade one-click AI optimization into a bounded, adaptive prompt compiler that supports mixed visual tasks, visible structure and safe plain-text fallback.

**Architecture:** Add a provider-neutral Prompt IR and semantic-module registry in the AI module. Keep one model call by default, validate and normalize structured output on the server, render the final prompt from valid sections, and expose optional recognition controls in the existing comparison dialog.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, OpenAI-compatible chat completions, Vitest, Testing Library and Playwright.

---

### Task 1: Define and test Prompt IR

**Files:**
- Create: `src/modules/ai/prompt-structure.ts`
- Create: `src/modules/ai/prompt-structure.test.ts`

Define bounded module IDs, labels, plan schema, request context, locked-literal extraction, JSON parsing, normalization, warning codes and deterministic rendering. Test mixed modules, duplicate/unknown data, fenced JSON, invalid fallback and missing literals.

### Task 2: Integrate structured optimization on the server

**Files:**
- Modify: `src/modules/ai/prompt-optimizer.ts`
- Modify: `src/modules/ai/types.ts`
- Modify: `src/app/api/v1/ai/optimize/route.ts`
- Modify: `tests/integration/ai-optimization.test.ts`
- Modify: `src/modules/ai/providers/openai-compatible.test.ts`

Add `auto` context, bounded visual hints and requested modules. Build a stable system instruction without category enumeration, send source/locked literals as user data, parse structured responses, render validated sections and preserve legacy plain-text output. Verify auth, ownership, rate limits, secrets, prompt-injection boundaries and malformed-provider fallback.

### Task 3: Add the structured result experience

**Files:**
- Modify: `src/components/ai/prompt-optimization-dialog.tsx`
- Modify: `src/components/ai/prompt-optimization-dialog.css`
- Modify: `src/components/ai/prompt-optimization-dialog.test.tsx`

Show recognition labels, module chips, warnings and a collapsed structure view. Add an accessible module-adjustment panel and retry controls while preserving focus trapping, stale-result protection, copy, apply and discard.

### Task 4: Connect editor and ImageHub context

**Files:**
- Modify: `src/components/editor/prompt-editor.tsx`
- Modify: `src/components/imagehub/imagehub-workbench.tsx`
- Modify: related component and E2E tests

Use `auto` for notes and `image_generation` for ImageHub. Pass AI Model/reference/aspect hints, preserve request options across retry, support user-selected module reruns and keep abort/idempotency protections.

### Task 5: Verify security and compatibility

Run focused unit, integration and component tests, then full lint, typecheck, Vitest, extension tests, production build, Playwright and `npm audit --omit=dev`. Review prompt injection, XSS-safe rendering, response bounds, credential redaction and provider fallback. Fix all critical/high findings and regressions.

### Task 6: Document, release and deploy

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: package and extension version metadata

Publish the next minor version, push `public-main:main`, wait for CI, create the release tag, verify Chrome assets, allow the guarded production updater to deploy, and verify revision, backup, migrations, containers, logs and public routes.
