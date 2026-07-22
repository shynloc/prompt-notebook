# ADR-0011: Use capability-oriented AI provider adapters

## Status

Accepted

## Context

Users may use OpenAI-compatible relays today and other providers later. Upstream request and response formats differ, while product workflows require stable optimization, vision, and image-generation behavior.

## Decision

Expose capability-oriented provider interfaces inside `src/modules/ai`. Ship an OpenAI-compatible adapter first. Persist provider type, base URL, remote model ID, and declared capabilities instead of embedding vendor-specific branches in route handlers or UI components.

## Consequences

### Positive

- API routes and product UI depend on stable internal contracts.
- Native provider adapters can be added without migrating prompt notes.
- Provider-specific validation and errors stay isolated.

### Negative

- “OpenAI-compatible” services still vary and require defensive parsing.
- Native Anthropic, Gemini, or other semantics are not automatically supported by the first adapter.

## Alternatives Considered

- Arbitrary user-defined HTTP templates: rejected because they create a large SSRF and secret-leakage surface.
- Hard-coded model endpoints copied from AIHUB: rejected because they prevent user configuration and portability.
