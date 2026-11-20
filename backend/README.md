# 1. ToolHub Backend

## 1.1. Database and Background Jobs

PostgreSQL is the only database. Apply schema and seed data before starting
API or Worker processes:

```bash
uv run alembic upgrade head
uv run python -m app.bootstrap
```

API and Worker are separate processes built from the same image:

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
uv run python -m app.worker --queues analysis,export,maintenance
```

RQ uses `REDIS_URL`; queues and timeouts are configured in `.env.example`.
`JOB_QUEUE_BACKEND=local` is reserved for tests and runs jobs in-process.

To migrate an existing SQLite database (one-off, truncates target tables):

```bash
uv run alembic upgrade head
PYTHONPATH=. uv run python ../scripts/migrate_sqlite_to_postgres.py \
  --source /path/to/toolhub.db \
  --target postgresql+psycopg://toolhub:toolhub@127.0.0.1:5432/toolhub
uv run python -m app.bootstrap
```

## 1.2. Authentication Cookie

Browser sessions use the `toolhub_session` HttpOnly cookie with
`SameSite=Strict`. Local HTTP development keeps `AUTH_COOKIE_SECURE=false`.
Production deployments served over HTTPS must set:

```env
AUTH_COOKIE_SECURE=true
```

The OAuth2 Bearer Token endpoint remains available for non-browser API
clients.

## 1.3. Task Artifacts

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

## 1.4. Asset Comparison Jobs

Asset comparison jobs run in independent RQ workers. The API only persists the
job and enqueues it; workers claim jobs with an atomic `queued -> validating`
database update, so multiple API and Worker replicas can run concurrently.
Job progress is written to PostgreSQL and published through Redis Pub/Sub.

Atlas Merge uses the same PostgreSQL + RQ model (`atlas_merge_jobs`). The API
returns `202` with a job id; clients poll `/tools/atlas-merge/jobs/{id}`. Job
rows are retained for 10 minutes after a terminal state, then cleaned lazily
and by the periodic task-artifact cleanup.

Asset comparison inputs are snapshotted and verified before execution.
Running jobs use cooperative cancellation at stage boundaries; Python threads
are not forcefully terminated. Active jobs that reach their TTL are extended
until they leave an active state. Expired terminal jobs retain a database
tombstone so subsequent job and artifact requests consistently return
`410 Gone`, while their files are removed.

Asset comparison stage logs include `job_id`, `user_id`, `module_key`,
`artifact_key`, `stage`, `elapsed`, `status`, `size_bytes`, and
`annotation_revision`. These fields can be used to compare validation,
comparison, module export, raw workbook, PDF, and ZIP timings on the VPS.
