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

## 1.2. Asset Comparison Jobs

Asset comparison artifacts are persisted outside the request lifecycle. VPS
deployments should point the artifact root at a persistent, writable
directory:

```env
ASSET_COMPARISON_ARTIFACT_ROOT=/var/lib/toolhub/asset-comparison-jobs
ASSET_COMPARISON_MAX_ACTIVE_JOBS=1
ASSET_COMPARISON_JOB_TTL_HOURS=24
ASSET_COMPARISON_MAX_STORED_JOBS=20
ASSET_COMPARISON_MAX_STORAGE_BYTES=1073741824
```

The initial job runner is designed for one Uvicorn worker. It uses an internal
bounded executor for comparison work, so a single Uvicorn worker does not
limit the comparison tasks to one CPU core.
