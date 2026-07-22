# Phase 3: Browser capture and scale readiness

## Product outcomes

- Capture selected text through the toolbar, keyboard shortcut, or `保存到提示词笔记本` context menu.
- Review and edit title, prompt, tags, source, and suggested artwork in a persistent side panel.
- Save once to the existing private cloud notebook and picbed-backed media workflow.
- Connect and revoke extension devices without exposing website session cookies.
- Measure list and search performance at 10k, 100k, and 1m notes.

## Release slices

1. Data provenance, device authorization, and capture APIs.
2. Text capture extension with tags and reliable retry.
3. Ranked image candidates and server-side image import.
4. Device management, source display, accessibility, packaging, and scale report.

## Non-functional acceptance

- No persistent `<all_urls>` permission.
- Access tokens expire after 15 minutes; refresh tokens rotate and expire after 30 days.
- A repeated idempotency key returns the original note instead of creating a duplicate.
- An image failure can degrade to a text-only save with a visible warning.
- Extension drafts survive panel closure and a service-worker restart.
- All authorization, ownership, schema, component, extension, and end-to-end tests pass.

