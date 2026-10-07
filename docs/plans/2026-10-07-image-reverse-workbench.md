# Image Reverse Workbench Implementation Plan

**Goal:** Fix the AI Model reference picker and make structured image-to-prompt reconstruction available in ImageHub and the prompt encyclopedia.

**Architecture:** A shared client workbench calls the existing authenticated reverse-prompt endpoint using the user's configured vision model. A bounded JSON document separates image observations, inferred details, final descriptions and requested changes; the server validates and renders a fixed module order. ImageHub and the encyclopedia reuse the same editor and transfer only explicitly confirmed results.

**Tech Stack:** Next.js, React, TypeScript, Zod, existing OpenAI-compatible adapter, Vitest and Playwright.

## Task 1: Reference-picker layout

- Modify `src/components/characters/generation-character-picker.tsx` and `character-profiles.css`.
- Render the modal outside the sticky control panel, constrain its dimensions and keep the footer visible while the list scrolls.
- Verify actual browser hit targets at desktop, tablet and mobile widths, with many images and optional feedback.

## Task 2: Structured reconstruction contract

- Add UI-safe `src/modules/ai/reverse-prompt-contract.ts` and server-only `reverse-prompt-structure.ts`.
- Fixed section IDs: theme, subject, appearance, clothing, pose, scene, composition, lighting, color, camera, style, text, quality and constraints. Include only relevant sections; allow multiple image categories.
- Preserve observations separately from final descriptions; record requested changes, uncertainties and an independent negative prompt.
- Accept bounded strict JSON (optionally one complete JSON fence), reject malformed, duplicate, unknown and unsafe fields without leaking provider content.
- Tests cover category combinations, ordering, user overrides, malformed JSON, malicious keys and size limits.

## Task 3: Authenticated API and provider

- Extend `reverse-prompt/route.ts`, service and adapter types with bounded additional requirements and language.
- Keep system instructions server-owned. Put user requirements in the user data message. One provider call per request.
- Validate source images, remote URL access and cancellation; retain per-user model ownership and secret encryption.
- Integration tests cover authentication, multipart/URL inputs, override delivery, invalid images and provider errors.

## Task 4: Shared workbench

- Add `src/components/ai/reverse-prompt-workbench.tsx` and styles.
- Support file selection, drag/drop, clipboard paste and image URLs; preview and optional requirements.
- Display progress, cancel/retry/configuration links, editable modules, final prompt, negative prompt, JSON, observations and change summary.
- Guard against double submissions, late results and applying a result from changed inputs; show action feedback.
- Allow explicit use in ImageHub, creation of a note and transfer to encyclopedia analysis.

## Task 5: Page integration

- Add a visible ImageHub entry and reuse the workbench for existing reference/result buttons.
- Add a third encyclopedia tab and pass the reconstructed prompt to term analysis only after a user action.
- Confirm before overwriting populated ImageHub fields; offer undo.

## Task 6: Verification and release

- Run focused tests, lint/typecheck, integration, browser journeys, production build and dependency audit.
- Verify client chunks do not contain server instructions or parsers.
- Bump coordinated release versions, update README/CHANGELOG, push public main and tag after CI succeeds.
- Pause the production updater for the push/CI window, deploy through the existing backup/rollback service, restore the timer and check commit, containers, backup checksum and public health.

## Execution

The user has authorized implementation, push and deployment in this task. Execute in the current clean checkout without requiring another approval; no delegation is requested.
