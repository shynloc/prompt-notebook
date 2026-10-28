# v1.9 local deployment and image-storage verification

Review date: 2026-10-28. This release extends the [public-readiness review](2026-10-28-public-readiness.md) and implements [ADR-0020](../adr/0020-local-deployment-and-private-instance-media.md).

## Implemented boundaries

- One application and database migration stream, with a dedicated Docker Compose local project. Explicit local mode accepts only strict HTTP loopback origins; it does not weaken server-mode email verification.
- New users default to instance-managed storage. Existing Picbed accounts keep their selection, credentials and existing images. Switching providers affects subsequent uploads only.
- Private files are outside `public`, owner-authorized and quota-accounted under a per-user database lock. Sharing grants access only to a valid share's cover and stops on revocation or expiry.
- Web and worker share a persistent private volume. Stable owner-scoped object keys support trusted data after an instance-origin change without permitting arbitrary localhost or private-network fetches.
- Cookie-authenticated writes reject a foreign `Origin`; extension Bearer authorization remains separate. Only explicitly configured, valid single-value client-IP headers are trusted.
- Database backup publication requires `pg_dump` success before compression. A successful gzip/checksum alone is not a restore drill.

## Completed local regression gates

| Gate | Result |
| --- | --- |
| Unit, component and PostgreSQL integration suite | 71 files, 421 tests passed |
| Browser suite | 40 tests in 17 files; final Playwright run passed |
| Chrome extension tests | 4 files, 7 tests passed |
| Production Web and worker builds | Passed; dynamic runtime-media paths excluded from build tracing |
| TypeScript / ESLint | Passed; existing navigation-image lint warnings remain non-blocking |
| Documentation / release configuration | Passed |
| Production dependency audit | Zero reported vulnerabilities at review time |
| README rendering | GitHub GFM, 1024/390 widths, no page overflow; 17 badges and 2 synthetic SVGs loaded |

The Windows PowerShell 5.1 launcher tests exercise failed/concurrent first writes and retained keys; POSIX-shell tests exercise backup-producer/compressor failures, collision handling and preservation of earlier backups. Local storage tests cover ownership, expired/revoked sharing, quota concurrency, symlink/path containment, disk reserve and an uncertain database-commit acknowledgement. Browser tests use synthetic accounts/images and never call paid models or a real image host.

## Operational acceptance

The release also requires a real local production-container installation, no-SMTP signup, image upload/read, anonymous denial, share/revoke, foreign-Origin rejection and restart-persistence checks before merging. Production deployment requires a fresh verified database dump, additive migration, exact-revision Web/worker readiness, public endpoint smoke checks and restored update/backup timers. Release and deployment results are recorded with the associated pull request and release.

## Deliberate limitations

- Local mode requires Docker and binds only to this computer. It is not a native desktop installer or automatic phone/LAN synchronization.
- JSON account export contains image metadata, not local image bytes. Preserve database, media volume and encryption keys together for instance recovery or migration.
- Deleting a note/history/reference does not reclaim its underlying local object; this avoids breaking other references. Account deletion purges the owner's namespace; an incomplete cleanup requires administrator attention.
- Existing public author-email metadata and early generic UI-test screenshots were not history-rewritten. The new README uses only original fictional artwork, never actual user pages or photos.
- No paid AI generation, real SMTP delivery, third-party provider compatibility test or production restore drill was performed as part of this automated regression.
