# Configuration

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | Public HTTPS origin used by authentication and extension authorization |
| `BETTER_AUTH_SECRET` | yes | Random application secret of at least 32 characters |
| `DATABASE_URL` | yes | PostgreSQL connection string; Compose provides this internally |
| `CREDENTIAL_ENCRYPTION_KEYS` | yes | Comma-separated `key-id:key` ring; every key is exactly 32 bytes in hex or base64url |
| `CREDENTIAL_ACTIVE_KEY_ID` | yes | Key ID used for newly encrypted model and image-storage credentials |
| `SMTP_HOST`, `SMTP_PORT` | production email | Verification and password-reset mail server |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | production email | Mail credentials and sender |
| `APP_IMAGE`, `IMAGE_TAG` | deployment | Container repository and immutable revision tag |
| `APP_PORT` | optional | Loopback port for the reverse proxy; default `5488` |

Image-host endpoints, image-host tokens, AI Base URLs, model IDs and model API keys are user-owned database settings. They must not be fixed in source code, Docker images, the Chrome extension, or shared server environment variables.

Never prefix a secret with `NEXT_PUBLIC_` or commit an environment file.

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

## User-configured endpoints

Model and image-host endpoints must be public HTTPS origins on port 443, without embedded credentials, query or fragment. Local, private, link-local, metadata, reserved and redirecting targets are rejected. Requests use DNS pinning to reduce DNS-rebinding risk.

The Chrome extension ships with no default server. The user enters an HTTPS origin in the side panel; the extension requests permission only for that origin, verifies `/health/live`, clears tokens after a server switch, then uses PKCE authorization. Plain HTTP is accepted only for `localhost` and `127.0.0.1` during development.

Run `npm run release:check` after building web and extension. Run `npm run release:check -- --production` with the production environment loaded before deployment.
