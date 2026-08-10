# Changelog

All notable changes use the Keep a Changelog structure. Versions follow Semantic Versioning.

## [Unreleased]

## [1.6.0] - 2026-08-10

### Added

- Added adaptive structured prompt optimization with a finite semantic-module vocabulary for portrait, product, landscape, poster, cover, infographic, comic and mixed visual work.
- Added a transient Prompt IR with recognized labels, selected modules, validated sections, factual warnings and server-rendered final prompts.
- Added structure inspection and user-correctable module selection to the optimization comparison dialog without changing the one-click default flow.

### Changed

- Prompt notes now use automatic general/image intent detection while ImageHub supplies explicit image-generation, AI Model, reference-image and aspect-ratio context.
- Image optimization uses bounded semantic capabilities instead of expanding a category-specific system prompt.
- The comparison dialog can correct an automatic classification, requires review for blocking fact or aspect-ratio conflicts, and resets confirmations for every retry.
- ImageHub cancels stale optimization requests and offers one-click undo after applying an optimized prompt.

### Security

- Treats provider structure as untrusted input with strict validation, fixed server-owned labels and ordering, bounded fields and safe legacy fallback.
- Extracts exact quoted and high-confidence numeric literals on the server and requires explicit confirmation before applying a result that omits protected content.
- Keeps source prompts and protected literals in the user message so they cannot alter system instructions.
- Updated vulnerable transitive `nanoid`, `brace-expansion` and `js-yaml` versions to patched releases.

## [1.5.0] - 2026-08-06

### Added

- Added a first-class AI Model character asset library with role cards, intended uses, cover/primary images, up to twelve ordered reference images, archive, trash and guarded permanent deletion.
- Added character Profile pages, linked-note waterfalls, prompt-card badges and many-to-many primary/supporting/reference note associations.
- Added an ImageHub casting picker for one AI Model and up to four character references, immutable generation provenance and automatic character binding when saving generated work.
- Added portable export format v2 for character profiles, images and note relations while retaining version-1 import compatibility.
- Added an identity-adapter boundary for future provider-native character tokens, FaceID and LoRA workflows without coupling the current release to one provider.

### Changed

- Renamed the Settings tab to make service-model configuration distinct from AI Model character assets.
- Raised the bundled Nginx request-body limit to 45 MB for four-reference ImageHub requests.
- Generation quotas and stale-job reconciliation now use bounded indexed queries as job history grows.

### Fixed

- Preserved selected characters beyond the first 100 library results and across archive/trash state changes.
- Made ImageHub explicitly offer an unlinked retry when a selected character becomes unavailable before note saving.
- Made interrupted v2 imports safely resumable and rejected duplicate portable note IDs before any import mutation.
- Closed generation preparation/cancellation races, retained legacy idempotency compatibility and guarded character deletion throughout the pre-queue window.

### Security

- Added owner-composite database constraints for note, character, generation and asset relationships.
- Pinned validated DNS results for remote media sockets, revalidated every redirect and rejected private, reserved and IPv4-mapped destinations.

## [1.4.2] - 2026-08-06

### Fixed

- Refreshed the lightbox image state when navigating between multi-image prompt notes.

## [1.4.1] - 2026-08-02

### Fixed

- Isolated authentication rate limits by the client IP supplied by the configured trusted reverse proxy.

## [1.4.0] - 2026-08-02

### Added

- Added the Dashboard overview with eight account metrics and a clickable per-tag note count table.

## [1.3.0] - 2026-07-23

### Added

- Added an AI Prompt Wiki analysis workbench that extracts exact reusable fragments, groups them by category and keeps users in control of selection and editing.
- Added a dedicated term-analysis model purpose with automatic fallback to the selected prompt-optimization model.
- Added guarded bulk term creation with built-in, account, and request-level duplicate detection.

### Changed

- Consolidated AI model and image-storage configuration behind one Settings sidebar destination with horizontal deep-linkable tabs.

### Security

- Updated Next.js to 16.2.11 to include the latest App Router, Server Action, cache and image-optimization security fixes; the production dependency audit is clean.

## [1.2.1] - 2026-07-22

### Fixed

- Preserved image covers and tags when a card-only action such as favorite or archive performs a partial note update.

## [1.2.0] - 2026-07-22

### Added

- Added an active-share management page with preview, title, share and expiry dates, seven-day renewal, and immediate revocation.
- Added a prominent share action to prompt previews with busy, success, error and clipboard-fallback feedback.

### Changed

- New share links now use a compact creation-date plus five-character random-code path while preserving legacy links until expiry.
- Active owner links can be copied again because their token is encrypted with the server credential key ring while public lookup remains hash-only.

## [1.1.2] - 2026-07-22

### Added

- Added same-origin authenticated image downloads with attachment filenames, so ImageHub results download directly instead of opening the image host in a new tab.
- Added visible per-job progress, success and failure feedback for ImageHub download, copy, cover, cancel, delete and save actions.

### Fixed

- Disabled asynchronous action buttons while requests are running and added tactile pressed/loading animation.
- Made saving an ImageHub result to notes idempotent for one year, preventing duplicate notes after repeated clicks, refreshes or network retries.

## [1.1.1] - 2026-07-22

### Added

- Added permanent deletion for completed, cancelled and failed ImageHub history records.
- Added deployment-level timeout controls for connection tests, prompt optimization, reverse prompting and image generation.

### Fixed

- Increased the default prompt-optimization timeout to 60 seconds and image-generation timeout to 10 minutes for slower compatible providers.
- Prevented automatic image retries after a client-side timeout, avoiding duplicate provider jobs and possible duplicate charges.
- Preserved sanitized upstream error details and request IDs so authentication, parameter and provider failures are actionable without exposing API keys.
- Made the prompt editor display the server's actionable AI error instead of replacing it with a generic network message.

## [1.1.0] - 2026-07-22

### Added

- Added seven common ImageHub aspect ratios, including 16:9 and 9:16.
- Added 1K, 2K and GPT Image 2 4K output presets plus auto, low, medium and high rendering quality.

### Fixed

- Passed Redis configuration to the production web container so generation jobs can enter the durable queue.
- Sent native GPT Image 2 sizes and output options instead of legacy size and response-format parameters.
- Added request IDs and actionable server diagnostics for unexpected API failures.

## [1.0.1] - 2026-07-22

- Fixed the production Compose build context for repository-root deployments.

## [1.0.0] - 2026-07-22

### Added

- Password-confirmed account deletion, bounded trash purging, backup status, and image-reference integrity reports.
- Immutable prompt history, restore, variable templates, projects, smart collections, and bounded bulk actions.
- Exact duplicate detection, similarity candidates, advanced search filters, and saved searches.
- Configurable self-hosted extension origins, optional permissions, recent captures, and idempotent retry feedback.
- Expiring, revocable, token-hashed read-only sharing with privacy controls.
- User-owned encrypted image-host settings used by uploads, web imports and ImageHub.
- Multi-provider AI configuration, confirm-before-apply Prompt optimization, reverse prompting and a durable generation queue.
- Generic self-host deployment, verified backup-first automatic updates and MIT licensing.
- Domain-neutral Chrome extension onboarding and GitHub Release packaging.

### Security

- Image-host requests now enforce public HTTPS, DNS pinning, private/reserved address denial, no redirects and bounded responses.
- Provider credentials use a rotatable AES-256-GCM key ring and never appear in API responses.
- Updated Sharp to 0.35.3; production dependency audit reports no known vulnerabilities.

## [0.2.0] - 2026-07-20

- First feature-complete private beta prepared for self-hosted release.
