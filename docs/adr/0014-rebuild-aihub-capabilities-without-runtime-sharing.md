# ADR-0014: Rebuild AIHUB capabilities without runtime sharing

## Status

Accepted

## Context

ACKS Image Web already demonstrates prompt optimization, reverse prompting, image generation, queueing, and picbed upload. Direct embedding or runtime integration would introduce two authentication systems and long-term coupling.

## Decision

Use ACKS Image Web as a reference for behavior and provider compatibility, but reimplement the required modules inside Prompt Notebook using Better Auth, Drizzle, the Prompt Notebook database, and the existing storage abstraction. Keep ACKS Image Web running independently until Prompt Notebook reaches verified feature parity.

## Consequences

### Positive

- Prompt Notebook stays independently deployable and open-source friendly.
- Users get one account, one permission boundary, and one note/image workflow.
- AIHUB failures or future retirement do not affect notebook data.

### Negative

- Some working code must be adapted instead of copied directly.
- Existing AIHUB credentials and history are not automatically migrated.

## Alternatives Considered

- iframe or external navigation: rejected because it fragments the user journey.
- Internal API calls into AIHUB: rejected because it preserves two databases and creates hidden deployment dependencies.
