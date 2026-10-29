# ImageHub resolution-tier compatibility implementation plan

> Execute task by task using the Code planning/verification workflow; implementation is authorized in this chat.

**Goal:** Restore 1K/2K/4K selection for the exact `gpt-image-2.5` compatibility alias without claiming that a third-party model is an official or verified deployment.

**Architecture:** Keep one shared capability resolver for the workbench, API preflight and provider serialization. Classify official IDs, explicit declarations, the exact compatibility alias and unknown IDs separately; retain existing owner configurations and forward the configured Model ID unchanged. Use the existing resolution presets and strict size validator, not a browser-only switch that the server rejects.

**Tech Stack:** Next.js 16.4 / React / TypeScript, Vitest, Playwright, PostgreSQL, Docker Compose and the existing deployment updater.

## Evidence and boundaries

- The selected server configuration uses `gpt-image-2.5` with automatic family detection. The old strict resolver recognizes only `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` and snapshots, so this alias enters the unknown/fixed-size branch.
- Official [image generation](https://developers.openai.com/api/docs/guides/image-generation) and [Images API](https://developers.openai.com/api/reference/resources/images/methods/generate) document GPT Image 2/2.5 custom dimensions: multiples of 16, maximum edge 3840, maximum aspect ratio 3:1, total pixels 655360–8294400. Above 3686400 pixels is experimental. Size is separate from rendering quality.
- Do not infer capabilities from arbitrary prefixes, change API keys/endpoints, rename a configured model, mutate existing settings or issue paid generation requests. Explicit family declarations continue to win.

## Task 1: Shared compatibility contract

Files: `src/modules/ai/image-capabilities.ts`, its test, and `src/modules/ai/providers/openai-compatible.test.ts`.

1. Add failing tests for the exact bare 2.5 alias, declaration precedence and unrelated aliases remaining unknown.
2. Expose `source: official | declared | provider_alias | unknown`; resolve only the exact bare alias to unverified 2.5-compatible capabilities.
3. Verify mocked provider requests preserve the original Model ID and requested 4K dimensions, with native options and no legacy response-format field.
4. Run `npx vitest run src/modules/ai/image-capabilities.test.ts src/modules/ai/providers/openai-compatible.test.ts` and TypeScript checks.

## Task 2: Workbench clarity

Files: `src/components/imagehub/imagehub-workbench.tsx` and its test.

1. Add failing component tests proving the bare alias displays 1K/2K/4K and six independent quality choices.
2. Show explicit output-resolution labeling, actual pixels and an unverified-alias notice. Unknown/fixed models must explain why larger dimensions are unavailable rather than pretending they were verified as unsupported.
3. Show experimental-size warnings based on pixel count, including large square 2K canvases; explain that the maximum tier is constrained by aspect ratio/pixel limits, not a 4096-pixel-square promise.
4. Retain the existing editorial design, selected-state feedback and original reference/mask behavior. Run the workbench component suite.

## Task 3: Browser and application regression

Files: `tests/e2e/imagehub.spec.ts`, release configuration and verification documentation.

1. Exercise the exact alias at desktop/mobile widths using synthetic accounts and mocked AI configuration/queue responses.
2. Select 1K, 2K and 4K; assert the submitted dimensions, independent quality and no overflow. Capture only synthetic UI evidence outside tracked documentation.
3. Run lint, TypeScript, application/integration and extension suites, Web/worker/extension builds, release/document checks and production dependency audit. No real model requests.

## Task 4: Release and deployment

1. Bump application/extension manifests to 1.9.1; record cause, safe compatibility behavior and documented limits.
2. Push a reviewed PR to the public repository and wait for CI. Do not publish private model endpoints or account data in docs/comments.
3. Pause the updater, verify a fresh database backup, merge/tag the exact tested tree, deploy and restore the timer even on failure.
4. Verify deployed SHA/version, Web/worker readiness, existing data preservation, public smoke endpoints and updater/backup timers. Confirm the deployed resolver maps the alias to unverified native capabilities without reading any credentials.
