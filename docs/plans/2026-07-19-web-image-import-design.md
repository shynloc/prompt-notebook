# Web page image import design

## Goal

Allow the image-link control to accept both direct raster URLs and ordinary web pages such as X photo pages, without navigating away from an unsaved prompt or weakening the existing upload security policy.

## Interaction

The link control is not a nested HTML form. Its button uses `type="button"` and invokes an isolated async action. Typing a transient source URL does not submit the prompt editor. During resolution the control reports progress, disables repeated requests, and keeps the user on the editor. A successful result is added to the selected artwork list; a failure remains visible beside the control in plain language.

## Resolution pipeline

1. Validate the submitted URL and block credentials, custom ports, local/private/link-local addresses, and unsafe schemes.
2. Fetch with manual redirect handling and validate every redirect target again.
3. If the response is a supported raster image, validate and upload it directly.
4. If the response is HTML, read at most 1 MiB and extract only declared preview metadata: `og:image`, `og:image:url`, `twitter:image`, `twitter:image:src`, and `link[rel=image_src]`.
5. Resolve relative URLs, decode HTML entities, deduplicate candidates, and try at most eight candidates.
6. Re-run the complete URL, byte-size, magic-byte, decoded-pixel, and image-format checks for each candidate before it reaches the picbed adapter.

X and Twitter status/photo URLs use a crawler user agent so their public Open Graph media metadata is present. No third-party X resolver, account token, page script execution, or arbitrary HTML rendering is used.

## Limits and failure behavior

- HTML: 1 MiB maximum.
- Image: 10 MiB and 40 million decoded pixels maximum.
- Redirects: four maximum per resource.
- Preview candidates: eight maximum.
- Request timeout: 20 seconds per request.

Pages without usable preview metadata return a specific “no importable preview image” error. Pages with metadata whose targets are inaccessible or invalid return a distinct candidate-validation error. Provider failures never submit or discard the prompt text.

## Verification

Unit tests cover direct images, Open Graph and Twitter Card attributes in different orders, relative URLs, HTML entities, missing metadata, private candidate addresses, oversized HTML, and invalid candidate bytes. A component regression test renders the image picker inside the prompt form and proves that importing does not submit the outer form. Production verification uses the reported X photo URL and confirms that the final stored URL belongs to the configured picbed.
