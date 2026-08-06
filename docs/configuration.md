# Configuration

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | Public HTTPS origin used by authentication and extension authorization |
| `BETTER_AUTH_SECRET` | yes | Random application secret of at least 32 characters |
| `BETTER_AUTH_IP_ADDRESS_HEADERS` | reverse-proxy deployment | Ordered, comma-separated client-IP headers that the trusted proxy overwrites; bundled Nginx uses `x-real-ip` |
| `DATABASE_URL` | yes | PostgreSQL connection string; Compose provides this internally |
| `CREDENTIAL_ENCRYPTION_KEYS` | yes | Comma-separated `key-id:key` ring; every key is exactly 32 bytes in hex or base64url |
| `CREDENTIAL_ACTIVE_KEY_ID` | yes | Key ID used for newly encrypted model and image-storage credentials |
| `SMTP_HOST`, `SMTP_PORT` | production email | Verification and password-reset mail server |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | production email | Mail credentials and sender |
| `APP_IMAGE`, `IMAGE_TAG` | deployment | Container repository and immutable revision tag |
| `APP_PORT` | optional | Loopback port for the reverse proxy; default `5488` |
| `AI_CONNECTION_TIMEOUT_MS` | optional | AI connection-test timeout; default `10000` (10 seconds) |
| `AI_TEXT_TIMEOUT_MS` | optional | Prompt-optimization timeout; default `60000` (60 seconds) |
| `AI_REVERSE_PROMPT_TIMEOUT_MS` | optional | Image reverse-prompt timeout; default `120000` (2 minutes) |
| `AI_IMAGE_TIMEOUT_MS` | optional | Image-generation provider timeout; default `600000` (10 minutes) |

Image-host endpoints, image-host tokens, AI Base URLs, model IDs and model API keys are user-owned database settings. They must not be fixed in source code, Docker images, the Chrome extension, or shared server environment variables.

Never prefix a secret with `NEXT_PUBLIC_` or commit an environment file.

## Authentication client IPs

Better Auth uses the client IP to isolate authentication rate limits and record session metadata. In a reverse-proxy deployment, set `BETTER_AUTH_IP_ADDRESS_HEADERS` only to a single-value header that the final trusted proxy always overwrites. The bundled Nginx configuration uses:

```text
BETTER_AUTH_IP_ADDRESS_HEADERS=x-real-ip
```

`X-Real-IP` is safe in that configuration because Nginx assigns it from `$remote_addr` instead of forwarding a browser-supplied value. When Cloudflare or another CDN is in front of Nginx, configure Nginx `set_real_ip_from` and `real_ip_header` for the CDN's current published address ranges so `$remote_addr` becomes the verified visitor address. Do not list an arbitrary user-controlled header, and do not expose the application container port directly to the public internet.

The bundled Nginx example allows a 45 MB request body. Keep an equivalent limit when using another reverse proxy: ImageHub accepts up to four 10 MB browser-uploaded reference images in one multipart request, plus form overhead. Individual image validation remains capped at 10 MB inside the application.

Leaving the variable empty preserves Better Auth's safe fallback behavior, but a multi-hop `X-Forwarded-For` chain cannot then be attributed to one visitor and authentication requests may share a per-route rate-limit bucket. `npm run release:check -- --production` rejects that production configuration.

The generation worker does not automatically retry an image request that reaches `AI_IMAGE_TIMEOUT_MS`, because the upstream provider may still be generating after the local connection closes. Rate limits and temporary upstream 5xx errors remain eligible for bounded queue retries. Increase the timeout for a known slow provider instead of repeatedly submitting the same generation.

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

## GPT Image 2

When the selected image-generation model ID is `gpt-image-2` (or a dated `gpt-image-2-*` snapshot), ImageHub sends the selected canvas dimensions directly to the Images API. The included presets satisfy the provider constraints and cover common square, photography, widescreen and mobile portrait ratios from 1K through 4K. Rendering quality maps directly to `auto`, `low`, `medium` or `high`.

High-resolution output above 2560×1440 is experimental at the provider. Prompt Notebook requests JPEG at 90% quality for GPT Image 2 so 4K results remain practical for the configured image host. Other OpenAI-compatible model IDs retain conservative legacy size mapping.

## User-configured endpoints

Model and image-host endpoints must be public HTTPS origins on port 443, without embedded credentials, query or fragment. Local, private, link-local, metadata, reserved and redirecting targets are rejected. Requests use DNS pinning to reduce DNS-rebinding risk.

The Chrome extension ships with no default server. The user enters an HTTPS origin in the side panel; the extension requests permission only for that origin, verifies `/health/live`, clears tokens after a server switch, then uses PKCE authorization. Plain HTTP is accepted only for `localhost` and `127.0.0.1` during development.

Run `npm run release:check` after building web and extension. Run `npm run release:check -- --production` with the production environment loaded before deployment.
