# Image storage providers

Prompt Notebook stores prompt content and image metadata in PostgreSQL. Original image bytes remain in the configured image service.

The built-in Picbed adapter sends a multipart upload from the server with `X-Auth-Token`. Browser clients never receive the token. A provider response must supply stable display and thumbnail URLs plus image metadata. Upload validation limits raster formats, bytes, decoded pixels, redirects, network destinations, and MIME signatures before data is accepted.

External image links and parsed webpage preview images may disappear when the source site changes. For durable ownership, upload the image to a provider you control. A database backup does not contain image bytes; back up the provider separately and preserve object URLs during restore.

To support another provider, implement the existing server-side provider contract, keep credentials out of client bundles, return stable object identifiers, and add failure, size-limit, and cross-user isolation tests.
