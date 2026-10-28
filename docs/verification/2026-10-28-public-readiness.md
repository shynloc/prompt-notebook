# Public privacy and standalone-deployment review

Review date: 2026-10-28. Baseline: public `main` at `19528947f730` (v1.8.0).

## Summary

The application can be self-hosted without the author's WordPress installation, domain, Cloudflare account, image host, AI gateway or application account. The repository's MIT license permits independent deployment and modification. This is not a zero-configuration or fully offline product: production authentication needs working SMTP, and image/AI features need compatible user-configured services.

No live credentials or private infrastructure identifiers were detected in the reviewed public content. This is a bounded review, not proof that every possible secret or historical external copy is absent. Public Git history is **not fully anonymous**: it retains author email metadata and early test-interface screenshots.

## Coverage and method

- Examined all 17 commits reachable from public main and all 16 public tags; tag targets are within the same reviewed history. The public remote exposed no additional branches at review time.
- Reviewed 1,286 reachable Git objects: 785 distinct blobs, including 767 text files and 18 PNG files; the baseline public tree contains 502 files.
- Used local Git/blob pattern scanning and manual source/configuration review for API keys, tokens, private keys, authenticated URLs, private infrastructure endpoints, personal paths, database exports and user content. A dedicated gitleaks installation was not available; no source was uploaded to an external secret-scanning service.
- Visually inspected all 14 historical UI screenshots. Checked all 18 PNGs for text/EXIF metadata.
- Downloaded and memory-unpacked the actual v1.8.0 Chrome release ZIP: 78,887 compressed bytes, ten entries, six text files. Scanned the manifest and compiled assets and checked its SHA-256 against the published release digest: `14ea436f95781a6b85a2aac20d92663f47ead5b8be18a19ded1e6ddb81b41242`.
- Reviewed deployment scripts, Compose, Docker build stages, authentication/email setup, model/storage adapters and extension instance authorization.

The internal development remote, production environment files, live databases, unreachable Git objects, forks, other downloaded copies, every historical binary release and container image/cache were outside scope. No production account, SMTP server or paid model request was used.

## Findings and changes

| Item | Result / action |
| --- | --- |
| Real secrets in public source/history | No real API key, token, private key, database backup, private server IP/domain or personal absolute path detected. Example/CI values are test fixtures; a `user:pass` URL is an outbound-rejection test using an example domain. |
| Published Chrome package | No author infrastructure endpoint or real credential detected. MV3 has no fixed `host_permissions`; users enter their own server and grant optional permissions. |
| Historical UI screenshots | Fourteen early screenshots remain under `docs/audit/2026-07-20/`. They show blank forms, generic test text and feature pages; no visible private notes, photos, account email, token or address bar detected. They are **not** used in the new README. |
| Commit identity | Existing public author/committer metadata contains a non-noreply email address. New work should use the verified GitHub noreply identity. Existing history/tags were not rewritten. |
| README artwork | Added two original, self-contained, static SVG illustrations with fictional content. No application screenshot, user image, remote font, script or embedded raster data. |
| Future accidental publication | Expanded Git/Docker ignores for environment variants, database backups/dumps and private keys while retaining safe templates and migration SQL. This prevents future inclusion; it does not erase any old copy/cache. |
| Production SMTP documentation | Corrected installation/configuration instructions: email verification is required in production and a healthy app can still have non-working email delivery. |
| Independent configuration | Documented user-owned AI/image-host credentials, protocol restrictions, own-domain extension setup and no author-service dependency. |

Removing an email or file from current source would not remove it from old commits, tags, forks or downloads. Complete historical removal requires an explicitly approved history/tag rewrite plus possible hosting-provider cache cleanup; no force push or tag rewrite was performed.

## Deployment requirements confirmed

- Docker Compose supplies PostgreSQL, Redis, Web, migrations and the generation worker. Linux deployment requires Git, Docker/Compose, curl, OpenSSL, a domain, HTTPS reverse proxy and working SMTP; host Node.js is not required for the Docker path.
- Production signup requires email verification. Missing `SMTP_HOST` / `SMTP_FROM` cannot be treated as a supported mail-free production login mode.
- Text-note functionality does not require a model or image host. Full image workflows require Picbed-compatible multipart upload with `X-Auth-Token` and stable public HTTPS image URLs. Arbitrary S3/R2 APIs or temporary signed URLs are not drop-in replacements.
- Model endpoints implement the supported OpenAI-compatible contract on public HTTPS/443. Private/localhost endpoints are blocked by the outbound security policy; no claim is made that every vendor-native API is compatible.
- Images live in the configured host, not PostgreSQL. Database dumps, encryption keys and hosted image files need separate preservation. Credential encryption is server-side, not end-to-end note encryption.
- Automatic updates are optional. Forks should review update remotes/branches. Application rollback does not reverse forward database migrations.

## Existing operational issue requiring follow-up

### Production dependency advisories found on 2026-10-28

The current `npm audit --omit=dev` does **not** pass: it reports six affected-package records (two low, one moderate, one high and two critical), including Next.js, Better Auth/adapters, Nodemailer and Zod. These are dependency/advisory records, not evidence of six distinct exploitable flaws in this application or of a live compromise. The clean audit recorded for the earlier release is a historical observation, not a current safety guarantee.

- Next.js 16.4.0 is in published affected-version ranges. [Image optimization advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw): its stated workaround is Sharp >=0.35.5, already pinned by this project, and the stated affected runtime is glibc Linux while the bundled image uses Alpine. [Cache-component advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr): the required multi-typed-array `use cache` function was not found in this application's source. These scope observations are not a substitute for taking the framework patches.
- [Better Auth adapter advisory](https://github.com/advisories/GHSA-44jh-23m7-hpcf) concerns PostgreSQL-backed rate-limit records; this application has not opted into database rate-limit storage. The affected package should still be updated through a tested dependency change.
- [Zod collection-validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) and Nodemailer address-parser advisories also require patched dependency releases and regression checks.

Runtime dependency upgrades and production deployment were not performed as part of the documentation-only edits without additional user approval. Do not remove the CI audit gate, use a forced major downgrade, or label this baseline dependency-clean. Patch, run complete tests/builds and re-audit before recommending it as a security-current new production installation.

### Backup export failure detection

**Backup export failure detection:** the current POSIX-shell backup command pipes `pg_dump` to `gzip` under `set -e`. A failed dump can be masked by a successful gzip exit, after which gzip/SHA checks can still accept an incomplete SQL export. This is a reliability defect, not evidence of a credential leak or a blocker to first installation.

This documentation/privacy task does not change that runtime script. Do not interpret the checksum sidecar or backup-event label as a successful database recovery test. Maintain a separately verified backup strategy and perform restore drills against a disposable target. A follow-up fix should explicitly check dump success before compression/publication and test upstream pipeline failure. Until then, do not rely solely on this script as the safety net for unattended migrations.

## Verification

- Production Compose template passes `config --quiet` with example-only settings.
- Release-configuration check passes; extension tests pass (four files / seven tests).
- Current production dependency audit fails as documented above; no vulnerability-free claim is made.
- Environment template changes are comments only; no live endpoint, key or account value added.
- Git ignore checks cover real environment variants, nested environment files, backups/dumps and key files while allowing both environment templates and migration SQL.
- README/local-document link and synthetic-illustration checks are available through `npm run docs:check`.

The review confirms configuration portability and executable checks, not a fresh remote-server installation with a real SMTP/model/image-host account. Deployment owners must still validate actual mail delivery, provider interoperability, image access and recovery on their own infrastructure.
