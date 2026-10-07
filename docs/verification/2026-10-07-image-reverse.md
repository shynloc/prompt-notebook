# Structured image reconstruction verification

Release: 1.7.0. No database migration is required for this feature.

## Scope and review

- Reused the existing owner-isolated reverse-prompt model preference and encrypted provider connection; no embedded provider credentials or server endpoints were added.
- Separated UI-safe contracts from provider instructions and server validation. Production client chunks were checked for the reconstruction system instruction and parser; neither is included.
- Retained SSRF-safe public HTTPS downloads, bounded upload/response streams and decoded image validation.
- Reviewed cancellation, stale results, overwrite confirmation, undo, optional hosted covers, duplicate-click guards and retry idempotency.
- AI Model selection uses a native modal in the browser top layer, independent of the sticky form's stacking context. The confirmation tray stays outside the scrollable photo list.
- Applied the existing editorial paper/ink/red design, constrained photo-strip widths and made all three encyclopedia tabs visible on mobile.

## Local checks

- TypeScript and ESLint: pass; the upgraded Next.js lint preset reports non-blocking full-page-navigation warnings in existing flows and session-storage handoffs.
- Full Vitest suite: 58 files, 263 tests pass, including authenticated PostgreSQL integration tests.
- Chrome extension: 4 files, 7 tests pass; build and coordinated 1.7.0 ZIP packaging pass.
- Full Playwright suite: 35 tests pass; the additional save-in-flight/Esc/focus-restoration scenario and the final mobile-tab regression also pass in a four-test focused run.
- Actual browser hit testing and screenshot inspection at 1440, 1024 and 390 pixels confirm that the AI Model confirmation button is visible, clickable and above the task wall.
- Production build, generation worker build and release configuration checks: pass.
- `npm audit --omit=dev`: zero vulnerabilities after upgrading Next.js, Sharp, Nodemailer, Vitest and affected transitive dependencies.

Local database tests first used an isolated PostgreSQL 17 container while the PostgreSQL 16 development image downloaded. GitHub CI repeats the full test suite on PostgreSQL 16 before production deployment.

Provider replies in automated tests are deterministic fixtures. Tests do not spend users' model credits or claim to measure the visual reasoning quality of their configured providers.

## Remaining development-only advisory

The full audit reports the unpatched `braces` stack-exhaustion advisory through the ESLint/Next lint tooling dependency chain. These packages are development dependencies and do not appear in the production audit. Lint only trusted repository input; do not use `npm audit fix --force`, which proposes downgrading the Next lint configuration to an incompatible major version. Revisit when an upstream patch is available.

## Deployment gates

Push the reviewed commit to public `main`, wait for CI, create tag `v1.7.0`, then deploy through the existing backup/health-check/rollback service. Restore the update timer and verify the exact deployed revision, web/worker state, public readiness, backup checksum and release artifacts.
