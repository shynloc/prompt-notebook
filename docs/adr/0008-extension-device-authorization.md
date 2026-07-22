# ADR-0008: Use PKCE-bound extension device authorization

## Status

Accepted

## Context

The extension must create private notes for the signed-in user. Reusing browser cookies is brittle across SameSite and cross-origin policies and gives the extension a broader session than it needs. Manually copied API keys are poor user experience.

## Decision

Use an OAuth-style authorization-code flow bound to PKCE. The extension opens a website approval page through `chrome.identity.launchWebAuthFlow`. The signed-in user approves a named device. A one-time, short-lived authorization code is exchanged with the verifier for a 15-minute opaque access token and a rotating 30-day refresh token.

Store only SHA-256 token hashes in PostgreSQL. Reject reused authorization codes and rotated refresh tokens. Store tokens in extension-local storage, never Chrome sync storage. Users can list and revoke devices from their profile.

## Consequences

### Positive

- Website sessions and extension credentials remain independent.
- Lost devices can be revoked without signing out other browsers.
- Tokens have least privilege and server-side expiry.
- The design works with hosted and self-hosted builds.

### Negative

- Requires credential tables and lifecycle cleanup.
- Token refresh adds client and server complexity.
- Development builds use a different extension redirect identity.

## Alternatives Considered

- Reuse Better Auth cookies: rejected because it is brittle and over-privileged.
- Permanent personal access token: rejected because rotation and onboarding are poor.
- Third-party OAuth provider: rejected because the application already owns its account system.

