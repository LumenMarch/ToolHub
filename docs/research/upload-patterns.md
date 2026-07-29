# File Upload API Design Patterns — Research Report

> **Date**: 2026-07-29  
> **Scope**: GitHub's upload APIs (Releases, Issues/PRs), industry patterns (tus, S3 presigned, multipart), and actionable insights for ToolHub.

---

## 1. GitHub Releases Asset Upload API

### 1.1 Endpoint Architecture

GitHub Release assets use a **dual-domain, hypermedia-driven** design:

| Aspect | Detail |
|---|---|
| Create release | `POST /repos/{owner}/{repo}/releases` → returns `upload_url` |
| Upload asset | `POST {upload_url}` — the URL from the previous step, **not** a hardcoded path |
| Upload domain | `https://uploads.github.com/...` (separate from `api.github.com`) |
| List assets | `GET /repos/{owner}/{repo}/releases/{release_id}/assets` |
| Download asset | `GET /repos/{owner}/{repo}/releases/assets/{asset_id}` — 200 or 302 redirect |

**Verified via `gh api`:**

```
$ gh api repos/actions/runner/releases/latest --jq '.upload_url'
https://uploads.github.com/repos/actions/runner/releases/356901421/assets{?name,label}
```

The `{?name,label}` suffix is an RFC 6570 URI template — the client expands it into query parameters. The `upload_url` is a **hypermedia control**: you never construct it manually; you always read it from the release object.

### 1.2 Upload Mechanics

- **Single-shot POST**: The entire file is sent as raw binary in the request body — no multipart, no JSON wrapper.
- **No chunking, no resumable upload**: There is no mechanism to resume a failed upload. If it fails, you retry the whole thing.
- **Query parameters**: `name` (required) and `label` (optional) are passed as query params on the upload URL:
  ```
  POST https://uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets?name=foo.zip
  Content-Type: application/zip
  Authorization: Bearer <token>
  
  <raw binary>
  ```
- **Authentication**: Bearer token, same as the rest of the API.
- **Size limit**: 2 GiB per file (hard cap). No total release size limit.
- **Asset limit**: Up to 1,000 assets per release.

### 1.3 Response Format

```json
{
  "url": "https://api.github.com/repos/.../assets/483731271",
  "browser_download_url": "https://github.com/.../releases/download/.../foo.zip",
  "id": 483731271,
  "name": "foo.zip",
  "label": null,
  "state": "uploaded",
  "content_type": "application/zip",
  "size": 77278514,
  "digest": "sha256:44a300f322a1b5bccfe0b146cf3ca74f27000eb8afed761d1ffd90be035969d4",
  "download_count": 950,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z",
  "uploader": { ... }
}
```

Key: `digest` is an **immutable, server-computed SHA-256** (introduced June 2025). It is calculated at upload time, not provided by the client. This provides content-addressing for integrity verification but is **not** used for deduplication (see §3.4).

### 1.4 Error States

| Status | Meaning |
|---|---|
| `201` | Upload successful |
| `422` | Filename collision — must delete existing asset first |
| `502` | Upstream failure — may leave a `"starter"` state asset (can be deleted) |

### 1.5 CORS

`uploads.github.com` does **not** emit `Access-Control-Allow-Origin` headers. Browser-based uploads to the release asset endpoint are blocked by CORS. This is by design: release asset uploads are intended for server/CLI clients, not browsers.

---

## 2. GitHub Issue/PR Image Upload (Internal)

### 2.1 Architecture

Image upload for Issues/PRs is **not a public API**. It is an internal, reverse-engineered 4-step flow using S3 presigned URLs:

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Step 0  │────▶│  Step 1  │────▶│  Step 2  │────▶│  Step 3  │
│ Repo Page│     │  Policy  │     │ S3 Upload│     │ Finalize │
│ (token)  │     │ Request  │     │ (presign)│     │ (GitHub) │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

### 2.2 Step-by-step

#### Step 0 — Obtain upload token

```
GET https://github.com/{owner}/{repo}
```

Extract `uploadToken` from the embedded JS in the page HTML. This requires the `user_session` cookie and acts as the CSRF `authenticity_token` for Step 1.

#### Step 1 — Request upload policy

```
POST https://github.com/upload/policies/assets
Content-Type: multipart/form-data

Fields: name, size, content_type, authenticity_token (=uploadToken), repository_id
```

Returns:
- `asset.href` — final CDN URL (`https://github.com/user-attachments/assets/{uuid}`)
- `form` — all presigned S3 fields (key, acl, policy, X-Amz-* signatures)
- `upload_url` — S3 bucket endpoint
- `asset_upload_authenticity_token` — CSRF token for Step 3

#### Step 2 — Upload to S3

```
POST {upload_url}  (S3 presigned URL)
Content-Type: multipart/form-data

Fields: all key-value pairs from Step 1's `form`, then the file as the last field
```

No GitHub authentication needed here — the presigned policy handles S3 authorization. Response: `204 No Content`.

The S3 policy has an observed **~30 minute expiration window**.

#### Step 3 — Finalize

```
PUT https://github.com{asset_upload_url}
Content-Type: multipart/form-data

Field: authenticity_token (=asset_upload_authenticity_token from Step 1)
```

This tells GitHub the S3 upload completed. Without this step, the `asset.href` returns 404.

### 2.3 Result URLs

| File type | URL pattern |
|---|---|
| Images | `https://github.com/user-attachments/assets/{uuid}` |
| Other files | `https://github.com/user-attachments/files/{id}/{name}` |

Images embed inline in markdown; other files render as download links.

### 2.4 Security Model

| Step | Auth |
|---|---|
| 0 (repo page) | `user_session` + `__Host-user_session_same_site` cookies |
| 1 (policy) | Same cookies + `uploadToken` as CSRF |
| 2 (S3 upload) | **None** — presigned URL is self-contained |
| 3 (finalize) | Cookies + `asset_upload_authenticity_token` from Step 1 |

The `__Host-user_session_same_site` cookie mirrors `user_session` but with `SameSite=Strict` — this is GitHub's double-submit CSRF pattern. Both must be present.

---

## 3. GitHub General Design Philosophy

### 3.1 Separate Upload Domain

Releases: `uploads.github.com` ≠ `api.github.com`. Image uploads: S3 bucket ≠ `github.com`.

This is a **blast-radius isolation** pattern:
- Upload bandwidth and failures don't affect the API.
- Different scaling characteristics (upload servers may need more ingress bandwidth, fewer CPU cycles).
- Can apply different rate-limiting, authentication, and timeout policies.
- CORS is deliberately **disabled** on `uploads.github.com` — browser-based release uploads are not a supported use case.

### 3.2 Hypermedia-driven URLs

The `upload_url` is never constructed by the client — it comes from the release response. This allows GitHub to:
- Change the upload endpoint transparently.
- Route different repositories to different upload backends.
- Version the upload infrastructure independently of the API.

### 3.3 File Reference vs. File Storage

| Layer | Pattern |
|---|---|
| **Metadata** | REST API (JSON) — `url`, `browser_download_url`, `id`, `name`, `size`, `digest`, `download_count` |
| **Storage** | Separate CDN/object storage — `uploads.github.com` for releases, S3 for images |
| **Download** | Either redirect (302) or proxy stream (200) from the API, or direct CDN URL |

The API serves as a **metadata layer** that points to the actual storage. This is the canonical "file reference vs. file storage" separation.

### 3.4 De-duplication Strategy

GitHub does **not** use content-addressable deduplication for release assets:
- The `digest` field is computed post-upload for integrity verification only.
- Uploading the same file twice with different names creates two separate assets.
- Filename collisions are rejected (422) — must explicitly delete before re-upload.

For Git objects (repos), GitHub uses SHA-1 content-addressing natively (Git's model), with packfile deduplication across fork networks. For user attachments, there is no public evidence of deduplication.

### 3.5 Large File Handling (>100 MB)

| Mechanism | Used by GitHub? |
|---|---|
| Single-shot POST | Release assets (≤2 GB) |
| Multipart chunked | Not in public API |
| Resumable (tus) | Not in public API |
| S3 presigned multipart | Image uploads only (internal, single-part presigned POST) |

GitHub's public API is **single-shot only**. For files >2 GB, users are directed to Git LFS (which uses a separate protocol) or external hosting.

### 3.6 Safety Measures

| Measure | GitHub Implementation |
|---|---|
| **CSRF** | Double-submit cookie pattern (`user_session` + `__Host-user_session_same_site`); per-step authenticity tokens |
| **Signature** | S3 presigned POST policy (AWS Signature V4) for image uploads |
| **Expiration** | S3 presigned policy ~30 minutes |
| **CORS** | Disabled on upload domain — prevents browser-based attacks |
| **Integrity** | Server-computed SHA-256 digest for release assets (immutable, post-upload) |
| **Idempotency** | Filename-based collision rejection (422); no `Idempotency-Key` header |
| **Rate limiting** | Applied per-token (release assets); per-session (image uploads) |

---

## 4. Industry-Standard Patterns

### 4.1 tus Protocol (Resumable Upload)

**What it is**: An open HTTP-based protocol for resumable file uploads (v1.0.0, 2016).

**Core flow:**

```
OPTIONS /files  →  discover server capabilities (Tus-Extension, Tus-Max-Size)
POST /files     →  create upload resource (Upload-Length header)
PATCH /files/{id} →  upload chunks (Upload-Offset, Content-Type: application/offset+octet-stream)
HEAD /files/{id} →  query current offset
```

**Key features:**
- Resumable: client queries `Upload-Offset` and resumes from where it left off
- Extensible: Creation, Expiration, Checksum, Concatenation extensions
- `Tus-Resumable: 1.0.0` header on every request
- Server tracks upload state persistently

**GitHub relationship**: GitHub does **not** use tus for any public API. The tus project itself is hosted on GitHub as a community project.

**IETF Standardization**: The IETF HTTP Working Group is drafting `draft-ietf-httpbis-resumable-upload` (as of 2025-2026), which converges with tus concepts (upload tokens, offset-based resumption) but targets native HTTP integration. This may eventually replace standalone tus implementations.

### 4.2 S3 Presigned URL Upload

**Pattern**: The application server never touches file bytes. It generates a time-limited, cryptographically signed URL that grants the client direct write access to object storage.

**Two variants:**

| Variant | Flow | Best for |
|---|---|---|
| **Presigned PUT** | API issues single signed URL → client PUTs file directly | Files <100 MB |
| **Presigned Multipart** | API creates multipart upload → issues per-part signed URLs → client uploads parts in parallel → API completes assembly | Files >100 MB, resumable |

**Security properties:**
- Credentials never leave the server
- URL is scoped to a specific bucket, key, and action (PUT/POST)
- URL has a configurable expiration (typically 5-60 minutes)
- Optional: policy document constrains size, content-type, metadata

**The canonical 3-step flow** (single-part):
```
1. Client → API:      "I want to upload report.pdf (2.3 MB)"
2. API → Client:      { uploadUrl: "https://s3.../xyz?signature=...", expires: "5m" }
3. Client → S3:       PUT {uploadUrl} + raw bytes
4. Client → API:      "Done: key=xyz"  (optional notification)
```

### 4.3 Multipart Chunked Upload (S3 Native)

```
1. CreateMultipartUpload     → UploadId
2. UploadPart (part 1..N)    → ETag per part (parallelizable)
3. CompleteMultipartUpload   → assembles final object
```

**Benefits over single-shot:**
- Parallelism: parts upload concurrently → higher throughput
- Resumability: only failed parts are retried
- No server-side buffering: API never sees the bytes
- Part size: 5 MB minimum, 5 GB maximum (S3), up to 10,000 parts

**Trade-off**: Higher client and server complexity. API must track `UploadId` + completed `ETags`. Incomplete multipart uploads incur storage costs until explicitly aborted or cleaned by lifecycle rules.

### 4.4 Comparison Matrix

| Pattern | Complexity | Resumable | Throughput | Server Load | Browser Support |
|---|---|---|---|---|---|
| Single-shot POST through API | Low | No | Low | High (proxy bytes) | Full |
| Single-shot POST to upload domain | Low | No | Medium | Medium (auth only) | Full (if CORS) |
| Presigned PUT to S3 | Low | No | High | Very low (auth only) | Full (CORS config) |
| Presigned multipart to S3 | High | Yes (per-part) | Very High | Very low | Partial |
| tus protocol | High | Yes (byte-level) | High | Medium (state mgmt) | Full (js client) |
| GitHub Release Assets | Low | No | Medium | GitHub-managed | No (CORS blocked) |
| GitHub Issue Images | Medium | No | High (S3) | GitHub-managed | Full (browser flow) |

---

## 5. Design Decisions — Why GitHub Chose What It Chose

### 5.1 Release Assets — Single-shot POST

**Why not resumable?**
- Release assets are typically uploaded from CI/CD pipelines (stable connections, retry-at-job-level).
- The 2 GB cap makes single-shot feasible on reasonable connections.
- The primary audience is automated tooling (`gh release upload`, `actions/upload-release-asset`) — not end-user browsers.
- Simplicity: one endpoint, one request, one status code. Easy to script in bash/curl.

**Why separate domain?**
- Blast-radius isolation for the critical API infrastructure.
- Different ingress bandwidth profile (few large uploads vs. many small API calls).
- Allows independent scaling and DDoS protection.

### 5.2 Issue Images — S3 Presigned

**Why S3 presigned?**
- Browsers need to upload directly (can't proxy through GitHub's API without CORS or huge ingress).
- GitHub doesn't want image bytes flowing through their app servers.
- S3 provides globally distributed edge ingestion (low latency for users worldwide).
- Presigned URLs are self-contained — the S3 step needs no GitHub auth.

**Why the 4-step flow?**
- Step 0 (token): CSRF protection — only authenticated users with write access get a token.
- Step 1 (policy): Server-side validation of file metadata, quota enforcement, abuse prevention.
- Step 2 (S3): Decoupled, scalable upload.
- Step 3 (finalize): Server knows when to make the asset available; triggers CDN cache invalidation; prevents orphaned S3 objects.

### 5.3 No Content-Addressable Dedup

Release assets are not deduplicated. This is a deliberate trade-off:
- Dedup requires either client-provided hashes (trust issue) or server-side full-file hashing (latency issue for large files).
- Release assets are relatively sparse (1000/release max) — storage cost of duplicates is negligible.
- Filename collision rejection is simpler to implement and reason about.
- The SHA-256 digest (added 2025) is a first step toward content-addressing without changing the dedup model.

---

## 6. Actionable Insights for ToolHub

### 6.1 Which Pattern to Adopt?

ToolHub should adopt a **hybrid pattern** based on file size and use case:

| Use Case | Recommended Pattern |
|---|---|
| Small files (<10 MB) — config, metadata, avatars | **Single-shot POST** to API server, validate & proxy to storage |
| Medium files (10–100 MB) — documents, exports | **Presigned PUT** to object storage (S3/R2) |
| Large files (100 MB–5 GB) — datasets, binaries | **Presigned multipart** (S3 multipart upload) or tus |
| CLI/automation uploads | **Single-shot POST** + retry at job level |

### 6.2 Key Design Decisions to Make

1. **Separate upload domain?**
   - _GitHub pattern_: `uploads.github.com`
   - _Recommendation_: Not needed for ToolHub's scale. Use a separate path prefix or subdomain only if upload traffic threatens API QoS.

2. **Hypermedia URLs?**
   - _GitHub pattern_: `upload_url` from release response
   - _Recommendation_: Worth adopting. Decouples upload endpoint from client code. Allows future migration to presigned URLs without client changes.

3. **Two-phase upload?**
   - _GitHub pattern_: Issue policy request → upload to S3 → finalize
   - _Recommendation_: Adopt for files >10 MB. Phase 1 validates permissions/size and returns a presigned URL. Phase 2 uploads. Phase 3 (optional) finalizes and triggers post-processing.

4. **Content addressing?**
   - _GitHub pattern_: Server-computed SHA-256 digest, not used for dedup
   - _Recommendation_: Compute SHA-256 at upload time for integrity. Consider content-addressable dedup only if duplicate files are common and storage cost matters.

5. **Resumable upload?**
   - _GitHub pattern_: Not supported
   - _Recommendation_: Defer. Single-shot + retry covers most ToolHub use cases. Add S3 multipart or tus only when large files (>500 MB) or unreliable connections become requirements.

### 6.3 Proposed API Surface

```
# Request an upload session
POST /api/uploads
Body: { name, size, content_type, [metadata] }
Response 201: {
  upload_id: "uuid",
  upload_url: "https://storage.example.com/uploads/uuid?signature=...",
  expires_at: "2026-07-29T01:00:00Z",
  finalize_url: "/api/uploads/uuid/finalize"
}

# Client uploads directly to upload_url (S3 presigned PUT)
PUT {upload_url}

# Client notifies server of completion
POST /api/uploads/{upload_id}/finalize
Response 200: {
  file_id: "uuid",
  url: "https://cdn.example.com/files/uuid/report.pdf",
  digest: "sha256:abc123...",
  size: 2345678
}
```

### 6.4 Security Checklist (from OWASP + GitHub patterns)

- [ ] Validate `content_type` against actual content (magic bytes), not just the header
- [ ] Enforce per-file size limits at the policy-creation step
- [ ] Apply per-user / per-IP rate limits on upload policy requests
- [ ] Presigned URLs: short expiration (5-15 minutes), scoped to specific key + action
- [ ] Serve user-uploaded content from a separate origin (CDN/subdomain)
- [ ] Sanitize filenames (allowlist approach, not denylist)
- [ ] Content-Disposition: attachment for non-image/non-video files
- [ ] Compute and store SHA-256 digest at upload time
- [ ] Scan uploaded files for malware before marking as "available"
- [ ] Authenticate download URLs for private files (signed URLs or auth proxy)

### 6.5 What NOT to Do

- **Do not proxy file bytes through the API server.** Even for small files, this creates unnecessary memory pressure and couples API scaling to upload throughput.
- **Do not use filename as the storage key.** Use a UUID or content hash. Filenames collide, contain special characters, and change.
- **Do not skip the finalize step.** A two-phase upload without finalization creates orphaned objects in storage and ambiguity about what "uploaded" means.
- **Do not make presigned URL expiration too long.** GitHub's 30-minute window is reasonable. Hours-long expirations enable replay attacks.

---

## 7. References

- [GitHub REST API — Release Assets](https://docs.github.com/en/rest/releases/assets)
- [GitHub Releases SHA-256 Digest (Changelog, June 2025)](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/)
- [gh-image: Reverse-engineered GitHub image upload flow](https://github.com/drogers0/gh-image/blob/main/documentation/github-image-upload-flow.md)
- [How GitHub Uploads and Secures Images](https://hazemhadi.com/articles/how-github-keeps-images-secure-article/)
- [tus Resumable Upload Protocol v1.0.0](https://tus.io/protocols/resumable-upload.html)
- [IETF HTTP Resumable Uploads Draft](https://datatracker.ietf.org/doc/draft-ietf-httpbis-resumable-upload/)
- [S3 Multipart Upload with Presigned URLs (AWS Blog)](https://aws.amazon.com/blogs/compute/uploading-large-objects-to-amazon-s3-using-multipart-upload-and-transfer-acceleration/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [GitLab Artifact Registry — Content-Addressable Storage ADR](https://gitlab.com/gitlab-org/ops/artifact-registry/-/blob/main/docs/adr/008_content_addressable_storage.md)
