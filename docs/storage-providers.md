# Image storage providers

Prompt Notebook stores prompt content and image metadata in PostgreSQL. Each account chooses instance-managed local files or an external Picbed-compatible image service in **Settings → Image storage**. New accounts default to local storage; previously configured Picbed accounts retain their existing selection.

## Private instance storage

The same local-storage provider works in server and local-Docker deployments. Web and worker share the private `local_media_data` volume; it is outside `public/`, owned by the unprivileged application user, and never configured through a user-supplied filesystem path. Media IDs and database records are owner-scoped. Normal reads require the owning session; an active share can expose only its designated cover through a separate token-authorized route. Closing/expiring a share blocks subsequent image reads from that link.

The default per-user quota is 1 GiB and the default free-disk reserve is 256 MiB. Administrators can adjust `LOCAL_MEDIA_QUOTA_BYTES` and `LOCAL_MEDIA_MIN_FREE_BYTES`; the settings page reports usage. Switching storage affects future uploads, not old files, and retains encrypted external-provider credentials. It neither migrates images nor makes private files public.

Removing a note, character reference or generation history does not automatically reclaim the underlying local object, which may still be referenced elsewhere. Account deletion cleans its own namespace; failed cleanup needs administrator attention. Preserve the media volume, database and credential keys together. A JSON account export contains metadata, not an archive of local image bytes. See [backup and restore](backup-and-restore.md).

## External image hosting

The built-in Picbed adapter sends a multipart upload from the server with `X-Auth-Token`. Browser clients never receive the token. A provider response must supply stable display and thumbnail URLs plus image metadata. Upload validation limits raster formats, bytes, decoded pixels, redirects, network destinations, and MIME signatures before data is accepted.

External image links and parsed webpage preview images may disappear when the source site changes. For durable ownership, upload the image to instance storage or a provider you control. External stable public URLs are not private account-protected storage, and general provider deletion is not part of the adapter contract. Back up that provider separately; a database backup does not contain its image bytes.

## Adapter contract

To support another provider, implement the existing server-side provider contract, keep credentials out of client bundles, return stable object identifiers, and add failure, size-limit, and cross-user isolation tests.
