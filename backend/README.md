# 1. ToolHub Backend

## 1.1. Authentication Cookie

Browser sessions use the `toolhub_session` HttpOnly cookie with
`SameSite=Strict`. Local HTTP development keeps `AUTH_COOKIE_SECURE=false`.
Production deployments served over HTTPS must set:

```env
AUTH_COOKIE_SECURE=true
```

The OAuth2 Bearer Token endpoint remains available for non-browser API
clients.

## 1.2. Task Artifacts

Uploads, user-scoped content cache entries, attendance results, and asset
comparison artifacts share one persistent storage root. VPS deployments should
point it at a writable directory:

```env
TASK_ARTIFACT_ROOT=/var/lib/toolhub/task-artifacts
TASK_ARTIFACT_BLOB_TTL_HOURS=168
TASK_ARTIFACT_BLOB_MAX_DISK_RATIO=0.2
TASK_ARTIFACT_CLEANUP_INTERVAL_HOURS=6
ASSET_COMPARISON_MAX_ACTIVE_JOBS=1
ASSET_COMPARISON_JOB_TTL_HOURS=24
ASSET_COMPARISON_MAX_STORED_JOBS=20
ASSET_COMPARISON_MAX_STORAGE_BYTES=1073741824
```

Files are deduplicated only within the authenticated user's storage scope.
Clients submit MD5, SHA-256, and file size for cache lookup. The server
recalculates both digests after receiving new content before publishing it to
the cache. Blob entries expire after the configured idle TTL. Cleanup runs at
startup and on the configured interval, then evicts the least recently used
entries until the cache is no more than 20% of the space available when the
cache itself is excluded.

## 1.3. Asset Comparison Jobs

The initial job runner is designed for one Uvicorn worker. It uses an internal
bounded executor for comparison work, so a single Uvicorn worker does not
limit the comparison tasks to one CPU core.
