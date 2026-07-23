# ADR-0017: Human-reviewed AI term curation

## Status

Accepted — 2026-07-23

## Context

Complete image and video prompts often contain reusable descriptions of people, poses, scenes, composition, cameras, lighting, color, atmosphere and style. Re-entering those fragments manually is slow, but writing every model suggestion directly into the vocabulary would create duplicates, invented phrases and low-quality entries. Users may also have only one text-capable model configured.

## Decision

The Prompt Wiki includes a dedicated analysis workbench. A signed-in user submits a complete prompt to a server-side analyzer, which treats the input as untrusted data and asks the selected model for bounded structured JSON. Candidate values must be exact excerpts of the original prompt, use an allowed category, and pass server-side length, count, normalization and duplicate checks.

Analysis never writes terms automatically. Results are grouped by category and users explicitly select, edit and batch-save candidates. Exact matches are disabled; similar matches are shown as warnings but remain reviewable. The batch endpoint repeats deterministic duplicate checks against built-in terms, stored custom terms and the current request.

`term_analysis` is a model purpose rather than a new provider capability. It requires the existing `prompt_optimization` text capability. A dedicated model can be selected in settings; otherwise the analyzer inherits the user's prompt-optimization model.

## Consequences

- Useful fragments can be curated quickly without turning model output into trusted database writes.
- Existing AI adapters, encrypted credentials and user isolation remain unchanged.
- Model responses that are malformed, invented or outside the controlled taxonomy are repaired once or rejected.
- Similarity warnings reduce accidental duplication but still leave the final semantic decision to the user.
- The analyzer is request-rate-limited and accepts at most 80 candidates per analysis or batch save.
