# ADR-0007: Use a Manifest V3 side-panel extension

## Status

Accepted

## Context

Prompt Notebook needs a fast way to capture selected prompt text, page provenance, tags, and optional artwork without sending users through a copy-and-paste workflow. The extension must remain suitable for Chrome Web Store review and later self-hosted builds.

## Decision

Build a separate React and TypeScript extension under `apps/extension` with Vite and Manifest V3. Use the Chrome Side Panel as the primary editor, a service worker for orchestration, and an on-demand page collector injected only after an action, context-menu, or keyboard gesture. Require Chrome 116 or newer.

Request only `activeTab`, `contextMenus`, `scripting`, `sidePanel`, `storage`, and `identity`, plus the configured notebook API origin. Do not request persistent access to every page.

## Consequences

### Positive

- The editor stays open while the user reads the source page.
- `activeTab` limits page access to explicit user gestures.
- A separate package can be published or reused by self-hosted instances.
- Vite produces a small auditable MV3 bundle without a browser-runner toolchain.

### Negative

- Chrome versions before 116 are unsupported.
- Side-panel state and service-worker state must be synchronized explicitly.
- The extension has its own build and release artifact.

## Alternatives Considered

- Toolbar popup: simpler, but closes too easily during editing.
- Open the website editor in a new tab: low implementation cost, but preserves most of the original workflow friction.
- Persistent content script on all pages: easier extraction, but requests excessive access.
- WXT: initially selected, then rejected after its development-only browser runner exposed unresolved high-severity transitive advisories; the product did not need its additional runtime abstraction.
