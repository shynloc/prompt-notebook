# GPT Image 2.5 compatibility and editing

## Release scope

Use the existing Images API and isolated user credentials. Recognize official Sunburst/Flare IDs and snapshots, expose explicit family declarations for aliases, and share one capability validator between UI, pre-queue validation and provider serialization. Never silently replace a requested image size.

## Completed implementation

- Shared model capability profiles, six quality levels and validated native dimensions.
- Per-task model selection; settings for compatibility, format, background and compression without dropping unrelated defaults.
- Request snapshots, provider usage/output metadata and actual result dimensions in history/note provenance.
- Up to 32 MiB generated results through storage/download/note metadata; browser-assisted conversion when reusing a large image as a 10 MiB reference.
- Continue-editing and first-local-reference mask painting, undo/clear and original-resolution PNG export.
- Owner-scoped mask persistence, strict PNG/alpha/size validation and EXIF orientation normalization.
- Bounded JSON/multipart requests, cancellation propagation and no automatic regeneration after ambiguous provider outcomes or post-generation storage failures.
- Additive migration 0017 for metadata, quality levels and mask assets; old records remain valid.

## Release gates

Run database migrations, full lint/type/unit/integration/extension tests, desktop/mobile browser tests, production builds, release configuration and production dependency audit. Push only reviewed source/configuration/documentation, wait for CI, then release and deploy with a database backup and readiness checks. No live paid model invocation is needed for automated validation.

## Deliberate limits

Four references/results; 10 MiB per input file; 44 MiB total multipart; 32 MiB per generated result. No streaming, provider conversation storage, LoRA or automatic provider billing estimates. Compatibility declarations do not make unsupported third-party APIs compliant. Partial image-host upload failures do not trigger regeneration and may leave remote files for image-host administration, consistent with the existing generic storage protocol.
