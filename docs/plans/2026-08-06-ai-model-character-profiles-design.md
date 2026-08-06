# AI Model Character Profiles Design

## Decision

Prompt Notebook will add a first-class, user-owned AI character asset domain. The product label is **AI Model / AI 模特**, while implementation names use `CharacterProfile` so the feature cannot be confused with the existing `ai_model_profiles` table that stores provider model configurations.

The first release supports one primary character per generation task and up to four selected reference images from that character. Notes use a many-to-many relation so a prompt can describe a primary and supporting characters. The design keeps extension points for multi-character generation, reference strengths, provider-specific identity adapters and LoRA identifiers without implementing those model-dependent features now.

## Product surfaces

- `/ai-models`: searchable, paginated character asset library.
- `/ai-models/new`: create a role card and upload references.
- `/ai-models/[id]`: profile, reference gallery, usage summary and linked-note waterfall.
- `/ai-models/[id]/edit`: edit, reorder, choose cover/main reference and archive.
- Prompt editor: bind one primary and optional supporting character profiles.
- Note cards and preview: show compact linked-character badges.
- AI ImageHub: open a responsive character selector, preview the profile row and choose up to four references.

## Character role card

Required data is deliberately small: name and role definition. Optional fields are summary, intended uses, appearance anchor, default prompt fragment, negative constraints, rights/source notes and flexible attributes. `attributes` is JSON metadata reserved for future structured traits; commonly queried use cases remain a text array.

Every profile can own at most 12 image metadata records. Binary data always goes through the user's configured image storage. One image can be the rectangular cover, one can be the primary generation reference, and the same image may hold both roles. Each image records a reference view (`portrait`, `half_body`, `full_body`, `left`, `right`, `back`, `expression`, `outfit`, or `other`), caption, order and cover focal point.

## Data model

### `character_profiles`

Owner-scoped profile data, optimistic `version`, timestamps and nullable `archived_at`. Profiles are archived rather than hard-deleted while in use.

### `character_profile_images`

Owner-scoped child images with storage metadata, view type, caption, order, `is_cover`, `is_primary`, focal point and extensible JSON metadata. Partial unique indexes enforce one cover and one primary image per profile.

### `note_character_profiles`

Many-to-many relation with `role` (`primary`, `supporting`, `reference`) and order. Composite owner foreign keys prevent cross-account association.

### `generation_character_references`

Generation provenance for the selected character and image. The generation service copies each selected remote image into the existing immutable generation reference assets before enqueueing the job. The row records the profile and image identifiers plus name/view snapshots so history remains understandable if a profile is later archived.

## API design

- `GET/POST /api/v1/ai-models`
- `GET/PATCH/DELETE /api/v1/ai-models/:id`
- `GET /api/v1/ai-models/:id/notes`
- Existing note create/update payloads gain `characterProfiles`.
- Existing note list gains `characterProfileId`.
- Existing generation create payload gains `characterProfileId` and `characterImageIds`.

Every route requires a session. IDs are validated as UUIDs and every repository predicate includes `user_id`. The client never submits arbitrary stored-image URLs for character references; it submits owned IDs and the server resolves them.

## Generation flow

1. The user selects one active character and one to four owned profile images.
2. The API validates that every image belongs to the selected profile and signed-in user.
3. The service reads each image with the secure outbound policy, validates size and magic bytes, then stores a generation reference snapshot in the configured image storage.
4. The job fingerprint includes stable profile/image IDs and hashes of browser-uploaded files. Replays therefore remain valid after a role card is renamed, archived or removed, while every first execution still snapshots and validates the actual remote bytes.
5. The queue receives only the job ID; the worker reads immutable generation assets as it does today.
6. Saving a successful job as a note automatically binds the selected character.

This flow preserves the isolated durable queue, prevents IDOR and SSRF shortcuts, and leaves provider adapters independent of character concepts.

## Failure and privacy rules

- A text-only profile can be saved without image-storage configuration.
- Each upload is independently retryable; failed uploads do not erase saved role-card data.
- An archived profile remains visible on existing notes and history but is hidden from the default ImageHub picker.
- Permanent delete is allowed only when the profile has no active generation job; note joins are removed without deleting notes.
- Permanent delete removes Prompt Notebook metadata only. Original files in a user-managed image host are not deleted because the current portable storage protocol exposes upload/read but no universal delete operation.
- A future storage-lifecycle adapter will support provider-specific asynchronous cleanup without coupling the character domain to one image host.
- Shared prompts do not expose full character cards, backup images, rights notes or other linked notes.
- Account export/import includes profiles, image metadata and note bindings.
- Thumbnails are lazy-loaded, APIs are paginated, and hydration batches related data to avoid N+1 queries.

## Accessibility and responsive behavior

Desktop ImageHub uses the requested row layout: avatar, name, primary photo and horizontal alternatives. Mobile uses stacked profile rows with a horizontally scrollable image strip. Selected references expose `aria-pressed`, a visible index and a live selection count. All dialogs trap focus, close with Escape and preserve form input on error.

## Verification targets

- Unit tests for validation, image selection and role-card UI.
- Integration tests for ownership isolation, archive/delete rules, note filtering, generation snapshots and transfer round trips.
- Browser tests for create/edit/profile, prompt binding and ImageHub selection on desktop and mobile.
- Production build, dependency audit, security review and live deployment smoke tests.
