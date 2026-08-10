# ADR 0019: Adaptive Prompt IR and semantic modules

- Status: Accepted
- Date: 2026-08-10

## Context

Prompt Notebook optimizes both general prompts and image-generation prompts through user-owned OpenAI-compatible model connections. Enumerating portrait, poster, infographic, cover, comic, landscape, product and every mixed combination in one system prompt would create unbounded duplication and inconsistent routing.

## Decision

Use a finite semantic-module vocabulary and a versioned Prompt IR. Image categories remain optional display labels and recipes; they do not control the core behavior. The model selects applicable modules in one response, and the server validates and renders sections. A clearly natural-language legacy response may use the plain-text compatibility path; malformed or truncated JSON-like output is rejected with a stable retryable error.

Request context and user overrides may preselect modules, with explicit module choices taking precedence over automatic classification. Original prompt text remains untrusted user content and is never interpolated into system instructions. A conservative server-side literal extractor owns the canonical exact-copy and high-confidence numeric list. Missing canonical literals, a truncated fact-lock list, conflicting ImageHub aspect ratios and explicitly requested modules missing from the result block ordinary Apply until the user confirms the risk.

Prompt IR remains transient in this release. Notes continue to store the compiled prompt string, preserving export, extension and API compatibility.

## Consequences

### Positive

- Mixed visual work composes existing capabilities instead of creating new types.
- The system prompt has a bounded token budget.
- Recognition is visible and correctable.
- Provider-specific renderers and persisted structure can be added later.
- Existing providers and clients retain a plain-text fallback.

### Negative

- Models without reliable JSON output may provide only the legacy result.
- One-call classification is less deterministic than a dedicated planning call.
- Literal preservation is conservative and cannot prove semantic factual accuracy.

## Rejected alternatives

- One complete system prompt per image type: category explosion and duplicated rules.
- One universal unvalidated free-form prompt: unstable and not correctable.
- Mandatory two-call planning: unnecessary default latency and cost.
- Vector retrieval in the first release: operational complexity without a large rule corpus.
