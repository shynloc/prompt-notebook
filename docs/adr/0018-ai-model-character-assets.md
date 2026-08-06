# ADR-0018: First-class AI character assets

## Status

Accepted — 2026-08-06

## Context

Users need reusable AI character role cards, reference images, note classification and ImageHub reference selection. Treating a character as a text tag cannot represent ordered images, role instructions, reference provenance or privacy rules. The codebase already uses `ai_model_profiles` for provider model IDs and capabilities, so reusing that name would conflate two unrelated concepts.

## Decision

Add a `CharacterProfile` domain inside the existing Next.js modular monolith. Product copy uses **AI Model / AI 模特**; code and database identifiers use `character_*`. Profiles and their image metadata are owner-scoped PostgreSQL records. Image bytes remain exclusively in each user's configured image storage.

Notes relate to profiles through a many-to-many owner-scoped join. A first-version generation selects one active profile and up to four of its images. Before queueing, the server resolves owned IDs, validates and copies those images into immutable generation reference assets. Provider adapters continue receiving ordinary reference buffers and remain unaware of the character domain.

Flexible JSON metadata and provenance records reserve extension points for multi-character tasks, reference weights, LoRA identifiers and provider-specific identity strategies without committing the initial release to any one model vendor.

## Consequences

### Positive

- Characters become reusable assets rather than fragile tags.
- Notes, generation history and profile pages share one ownership-safe domain.
- Existing durable queue and user-owned storage guarantees remain intact.
- Provider-specific consistency features can be added later behind adapters.

### Negative

- New joins increase note hydration and transfer complexity.
- Remote character images must be read and snapshotted before a job can queue.
- Product wording must consistently distinguish AI 模特 from AI service models.
- The generic image-host contract cannot yet delete remote objects, so permanent profile/history deletion removes application metadata but leaves image-host lifecycle under the user's control until a provider-neutral cleanup adapter is added.

### Neutral

- The first release intentionally supports one primary character per generation task.
- Profiles can be archived; permanent deletion is a separate guarded action.

## Alternatives considered

- **Special tags:** rejected because tags cannot model image roles or immutable generation provenance.
- **Immediate identity/LoRA engine:** deferred because provider semantics differ and would add operational complexity before the asset workflow is validated.
- **Separate microservice:** rejected because the current scale and deployment model favor the existing modular monolith.
