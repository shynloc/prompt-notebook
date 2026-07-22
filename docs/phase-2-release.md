# Visual Notebook release

This release completes the visual prompt-management experience planned after the account and cloud-storage foundation.

## User capabilities

- Create and edit prompts with up to 20 private tags and eight artwork images.
- Upload JPEG, PNG, and WebP files through the server-only picbed adapter.
- Import a public image URL after SSRF, byte-size, magic-byte, and decoded-pixel checks.
- Import a web page preview from Open Graph or Twitter Card metadata, including public X photo pages, without a third-party resolver.
- Reuse images previously attached by the same account without exposing a global picbed listing.
- Search titles, prompt text, and tag names with cursor pagination.
- Browse tag collections, rename/delete tags, and merge tags through the API.
- Use the built-in bilingual prompt vocabulary or create, edit, and delete private terms.
- Copy, edit, soft-delete, and open a complete prompt in the accessible preview overlay.

## Image-storage contract

Each signed-in user configures a Picbed-compatible endpoint and token in Settings. The token is encrypted with the server credential key ring, never returned to the browser, and sent only by the upload adapter as `X-Auth-Token`. The adapter posts multipart fields named `file` and `path`.

The application database stores URLs and metadata, not image bytes. A note uses the first ordered image as its cover. Reusing a stored object across multiple notes is supported.

## Operational limits

- Maximum upload: 10 MB.
- Maximum decoded image: 40 million pixels.
- Supported upload formats: JPEG, PNG, WebP.
- Maximum images per prompt: 8.
- Maximum tags per prompt: 20.
- Maximum prompt length: 100,000 characters.

External URL imports reject credentials, custom ports, private/link-local addresses, unsafe schemes, oversized responses, excessive redirects, and unsupported raster content.

## Deployment verification

1. Run database migrations before the new web container starts.
2. Confirm `/health/ready` returns HTTP 200.
3. Create an account and a prompt with a tag.
4. Upload an image, save, refresh, and confirm the cover remains visible.
5. Search by tag and open the preview overlay on desktop and mobile.
