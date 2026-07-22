# Changelog

All notable changes use the Keep a Changelog structure. Versions follow Semantic Versioning.

## [Unreleased]

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
