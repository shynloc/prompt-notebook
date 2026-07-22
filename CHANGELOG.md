# Changelog

All notable changes use the Keep a Changelog structure. Versions follow Semantic Versioning.

## [Unreleased]

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
