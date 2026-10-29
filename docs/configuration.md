# Configuration

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | HTTPS server origin, or strict HTTP loopback origin in explicit local mode; used by authentication and extension authorization |
| `APP_DEPLOYMENT_MODE` | optional | `server` by default; explicit `local` is restricted to a strict HTTP loopback origin and bypasses mandatory signup email verification |
| `BETTER_AUTH_SECRET` | yes | Random application secret of at least 32 characters |
| `BETTER_AUTH_IP_ADDRESS_HEADERS` | reverse-proxy deployment | Ordered, comma-separated client-IP headers that the trusted proxy overwrites; bundled Nginx uses `x-real-ip` |
| `DATABASE_URL` | yes | PostgreSQL connection string; Compose provides this internally |
| `CREDENTIAL_ENCRYPTION_KEYS` | yes | Comma-separated `key-id:key` ring; every key is exactly 32 bytes in hex or base64url |
| `CREDENTIAL_ACTIVE_KEY_ID` | yes | Key ID used for newly encrypted model and image-storage credentials |
| `POSTGRES_PASSWORD` | Docker production | Database password; use a long random hex value to avoid connection-URL reserved characters |
| `SMTP_HOST`, `SMTP_FROM` | production signup | Working mail server and permitted sender; required for default production email verification and password reset |
| `SMTP_PORT` | optional | SMTP port; default `587`; `465` enables implicit TLS |
| `SMTP_USER`, `SMTP_PASSWORD` | provider-dependent | SMTP credentials when the mail provider requires authentication |
| `APP_IMAGE`, `IMAGE_TAG` | deployment | Container repository and immutable revision tag |
| `APP_PORT` | optional | Loopback port for the reverse proxy; default `5488` |
| `LOCAL_MEDIA_ROOT` | local image storage | Private image directory; Docker Compose mounts `/app/data/media` in the same persistent web/worker volume |
| `LOCAL_MEDIA_QUOTA_BYTES` | optional | Per-user instance-local image quota; default `1073741824` (1 GiB) |
| `LOCAL_MEDIA_MIN_FREE_BYTES` | optional | Free-disk reserve checked before local uploads; default `268435456` (256 MiB); `0` disables this check |
| `AI_CONNECTION_TIMEOUT_MS` | optional | AI connection-test timeout; default `10000` (10 seconds) |
| `AI_TEXT_TIMEOUT_MS` | optional | Prompt-optimization timeout; default `60000` (60 seconds) |
| `AI_REVERSE_PROMPT_TIMEOUT_MS` | optional | Image reverse-prompt timeout; default `120000` (2 minutes) |
| `AI_IMAGE_TIMEOUT_MS` | optional | Image-generation provider timeout; default `600000` (10 minutes) |

Image-host endpoints, image-host tokens, AI Base URLs, model IDs and model API keys are user-owned database settings. They must not be fixed in source code, Docker images, the Chrome extension, or shared server environment variables.

Never prefix a secret with `NEXT_PUBLIC_` or commit an environment file.

## Standalone deployment and required email

Docker deployment does not require Node.js or npm on the host: the image builds and packages them. The host needs Git, Docker Engine/Compose, `curl`, OpenSSL for generating secrets, and an HTTPS reverse proxy. Node.js 22 is used for local development or building the Chrome extension from source. Use your own `APP_URL`; WordPress, Cloudflare and the author's infrastructure are not required.

Keep populated configuration and backups outside the checkout, for example `/opt/prompt-notebook/.env` and `/opt/prompt-notebook/backups`, and pass `ENV_FILE` to deployment/backup scripts. The versioned `.env.example` files are templates, not usable production credentials. Choose independent random values for the database password, authentication secret and credential-encryption key.

**Server deployments require email verification by default. Configure working SMTP before registering users.** An empty `SMTP_HOST` does not select a production server console-mail fallback. Infrastructure readiness can still pass while mail delivery is unavailable; complete an actual signup/verification test. `SMTP_FROM` must be a sender permitted by the mail service. Port 465 uses implicit TLS, while other ports use the provider's STARTTLS support.

The explicit local exception is `APP_DEPLOYMENT_MODE=local` together with an `APP_URL` such as `http://127.0.0.1:5488`. Only exact HTTP `localhost`, `127.0.0.1` or `[::1]` origins are accepted; remote hosts, paths, queries, embedded credentials and ambiguous IP spellings are rejected. This mode disables mandatory signup email verification and uses private local console mail even when `NODE_ENV=production`. Never expose it publicly. The [local launch scripts](installation.md#local-deployment) enforce loopback publishing and generate persistent random credentials without host Node.js.

Text-only notes do not require AI or image-host credentials. New users default to instance-local image storage without external credentials; a previously configured Picbed connection remains selected until the user chooses otherwise. AI features need appropriate model connections. All per-user settings are independent of the author's services.

## Instance-local media persistence

The web and generation worker mount the same named `local_media_data` volume at `/app/data/media`. The image directory belongs to the unprivileged container user (UID/GID 1001), mode `0700`; it is not under `public/` and images are served through owner-checked or active-share-authorized routes. Changing providers does not migrate existing image bytes automatically. Back up this volume together with PostgreSQL and preserve the origin/image references when moving an installation.

`LOCAL_MEDIA_QUOTA_BYTES` limits each user's stored local bytes; it is not a physical disk reservation or a system-wide quota. Keep free disk for all users and backups. Custom bind mounts must be writable by UID/GID 1001 without using world-writable permissions. Local storage is available in both server and local deployment modes; it is distinct from the loopback-only authentication exception.

## Authentication client IPs

Better Auth uses the client IP to isolate authentication rate limits and record session metadata. In a reverse-proxy deployment, set `BETTER_AUTH_IP_ADDRESS_HEADERS` only to a single-value header that the final trusted proxy always overwrites. The bundled Nginx configuration uses:

```text
BETTER_AUTH_IP_ADDRESS_HEADERS=x-real-ip
```

`X-Real-IP` is safe in that configuration because Nginx assigns it from `$remote_addr` instead of forwarding a browser-supplied value. When Cloudflare or another CDN is in front of Nginx, configure Nginx `set_real_ip_from` and `real_ip_header` for the CDN's current published address ranges so `$remote_addr` becomes the verified visitor address. Do not list an arbitrary user-controlled header, and do not expose the application container port directly to the public internet.

The bundled Nginx example allows a 45 MB request body. Keep an equivalent limit when using another reverse proxy. ImageHub accepts up to four reference images and one mask; each file is limited to 10 MiB and the entire multipart request, including form overhead, to 44 MiB. Reduce file sizes when combining four large references with a mask. Generated output storage/downloads support up to 32 MiB per image; configure the image host to accept that size too. General uploads and remote-link imports remain limited to 10 MiB.

Leaving the variable empty preserves Better Auth's safe fallback behavior, but a multi-hop `X-Forwarded-For` chain cannot then be attributed to one visitor and authentication requests may share a per-route rate-limit bucket. `npm run release:check -- --production` rejects that production configuration.

The generation worker does not automatically retry an image request that reaches `AI_IMAGE_TIMEOUT_MS`, loses its connection without a definite response, returns an interrupted body, or completes before storage fails: the provider may already have generated and charged for it. Stale running tasks are marked as having an unknown upstream outcome instead of being regenerated. Explicit rate limits and temporary upstream 5xx errors remain eligible for bounded queue retries. Increase the timeout for a known slow provider instead of repeatedly submitting the same generation. Cancelling requests aborts the local provider connection but cannot guarantee upstream cancellation or a refund.

## Credential encryption and rotation

Generate a 32-byte key with a secure password manager or `openssl rand -hex 32` and place it only in the protected server environment:

```text
CREDENTIAL_ENCRYPTION_KEYS=2026-07:<32-byte-key>
CREDENTIAL_ACTIVE_KEY_ID=2026-07
```

To rotate, append a new key and switch the active ID. Keep old keys until every credential has been rewritten:

```text
CREDENTIAL_ENCRYPTION_KEYS=2026-07:<old-key>,2027-01:<new-key>
CREDENTIAL_ACTIVE_KEY_ID=2027-01
```

Back up this key ring separately from PostgreSQL. Losing all copies makes stored provider credentials unrecoverable. Account exports intentionally exclude plaintext keys, ciphertext, IVs and authentication tags.

Legacy `AI_CREDENTIAL_ENCRYPTION_KEYS` and `AI_CREDENTIAL_ACTIVE_KEY_ID` remain readable for a migration window, but new deployments should only use the generic names above.

## GPT Image model capabilities

ImageHub automatically recognizes `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2`, GPT Image 1/1.5/mini and their dated snapshots, plus `dall-e-3`. The exact shorthand `gpt-image-2.5` is treated as an **unverified provider compatibility alias**, not an official model ID; it exposes the 2.5 parameter contract while forwarding that original ID unchanged. Other vendor-prefixed or suffixed names still require an explicit compatibility-family selection. Settings expose that override, and explicit declarations always take precedence. Unknown IDs use conservative standard sizes with an explanation; unsupported sizes are rejected rather than silently substituted. Selecting or inferring a compatibility contract is not a successful provider-capability probe.

GPT Image 2 / 2.5 send canvas dimensions directly to the Images API: 16-pixel multiples, longest edge at most 3840, aspect ratio at most 3:1 and total pixels between 655,360 and 8,294,400. Presets cover square, photography, widescreen and phone ratios from 1K through 4K. Output above 3,686,400 total pixels (2560×1440) remains experimental, including a 2048×2048 square. The 4K/max tier uses 3840×2160 or 2160×3840 for widescreen/phone; its square preset is 2880×2880 because 4096×4096 exceeds the API's pixel and edge limits. 2.5 adds `xhigh` and `max` to `auto/low/medium/high`; quality and output canvas size are separate controls.

Generation settings persist model-family, `output_format`, `background` and optional `output_compression` under the model's defaults. JPEG at 90% is the default for recognized GPT models; PNG does not send compression. Transparent backgrounds require PNG or WebP and a supporting model. Image2 keeps conservative opaque-background behavior; 2.5 enables transparency and mask editing. Request prompt plus the appended negative prompt is limited to 32,000 characters. Application cost/safety limits remain four output images and four reference images, even when the provider permits more.

The Images API is used for both generation and multipart edits. No Responses API conversation or streaming state is required. A mask is a PNG with alpha matching the first local reference's displayed dimensions; the server normalizes EXIF orientation before storage and provider submission. AI Model character references cannot currently be mixed with a local edit mask. Stored results include requested settings, actual asset dimensions and allowlisted provider usage fields, but not provider secrets or billing estimates.

Official references: [image generation guide](https://developers.openai.com/api/docs/guides/image-generation), [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare).

## User-configured endpoints

Model and image-host endpoints must be public HTTPS origins on port 443, without embedded credentials, query or fragment. Local, private, link-local, metadata, reserved and redirecting targets are rejected. Requests use DNS pinning to reduce DNS-rebinding risk.

The model adapter expects OpenAI-compatible authentication and endpoint contracts; a vendor's unrelated API or a private/local Ollama endpoint is not automatically supported. A custom model-family selection declares which request features to send, not verified support from that supplier.

The image adapter currently expects a Picbed-compatible `POST multipart/form-data` upload containing `file` and `path`, authenticated with `X-Auth-Token`. The response may expose `url`, `publicUrl`, `public_url`, `href`, `location`, `key` or `path`, directly or in a nested `data` object. It must resolve to a stable publicly readable HTTPS image URL; expiring signed query URLs are not supported. This is not direct generic S3/R2/Cloudinary support; those services require a compatible gateway or a separately implemented adapter. Provider tokens remain server-side. Testing image storage uploads a small real test image.

The Chrome extension ships with no default server. The user enters an HTTPS origin in the side panel; the extension requests permission only for that origin, verifies `/health/live`, clears tokens after a server switch, then uses PKCE authorization. Plain HTTP is accepted only for `localhost` and `127.0.0.1` in local deployment or development; use the exact configured local origin and port.

Run `npm run release:check` after building web and extension. Run `npm run release:check -- --production` with the production environment loaded before deployment.
