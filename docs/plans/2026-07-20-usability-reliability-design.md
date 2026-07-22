# Usability, reliability, and portability design

## Status

Approved for implementation from the 2026-07-20 audit and the existing Phase 4/5 decisions. Chrome Web Store submission is excluded.

## Product direction

Keep the current visual language and modular monolith. Improve daily usefulness without redesigning the product: make state truthful, preserve work locally, expose organization already present in the schema, and make user data portable. Avoid a dedicated search service, real-time collaboration, and a complex offline mirror.

## Reliability model

Each new/edit form owns a versioned IndexedDB draft keyed by `new` or note ID. A debounced write occurs after input changes and emits one of `saving-local`, `saved-local`, `syncing`, `synced`, `offline`, or `error`. A recovered draft is never silently applied over a newer server record: the editor offers restore or discard when both exist.

Explicit Save remains the cloud commit boundary. If offline, the draft remains local and Save explains that it will not be lost; this release does not pretend that an unsent write already exists in PostgreSQL. This intentionally ships the highest-value portion of ADR-0005 before a general mutation outbox.

## Organization model

Use existing `favorite`, `archivedAt`, and `deletedAt` fields. Add gallery views for active, favorites, archived, and trash; server queries remain user-scoped and cursor-paginated. Cards expose favorite and archive as recoverable actions. Trash supports restore and intentionally omits permanent deletion until delayed image cleanup exists.

Search retains fuzzy title/prompt/tag behavior and gains view, image-presence, and sort controls. URL query parameters remain the shareable source of gallery state.

## Portability model

Export a versioned JSON document containing notes, tags, custom terms, provenance, parameters, and image references—never sessions or tokens. Import is two-step: validate and preview counts, then submit the same normalized document with a digest-backed import ID. Existing note IDs/content are skipped; invalid entries block the commit. Imports use bounded transactions and `captureMethod=import`.

## Operations and distribution

Add repeatable PostgreSQL backup/restore scripts, a release-retention script that requires explicit keep tags, a manual GitHub deployment workflow, and clean-machine self-hosting documentation. Keep the repository private and omit a license until the owner chooses one. Package the Chrome extension ZIP with each release, but do not submit it to the store.
