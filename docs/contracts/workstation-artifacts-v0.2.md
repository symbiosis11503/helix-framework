# Workstation Artifacts Contract (v0.2 draft)

**Status**: draft for cross-check — 2026-04-22  
**Owner**: Hermes (artifact return contract)  
**Cross-check**: CC1 (helix-framework), CCOC (runtime implementation)  
**Depends on**: `docs/contracts/workstation-api.md` v0.1 draft

---

## 1. Goal

Phase 1 workstation API already returns:
- task status
- text result
- logs URL

Phase 2 extends this so a workstation task can return **real artifacts** such as:
- screenshots
- PDFs
- downloaded files
- generated documents
- structured exports

The caller should not need shell access to fetch these manually.

---

## 2. Core Rule

**Small metadata inline, file bytes out-of-line.**

Do not inline large binary payloads in task result JSON.
Use:
- task result JSON for artifact metadata
- dedicated artifact endpoints for download/preview

Only allow inline payloads for tiny text/debug outputs if explicitly enabled later.

---

## 3. Artifact object shape

Every completed task may return `result.artifacts[]`.

```json
{
  "artifact_id": "art_01J...",
  "task_id": "ws_01HXYZ...",
  "kind": "screenshot",
  "name": "homepage.png",
  "mime": "image/png",
  "size_bytes": 45231,
  "sha256": "abc123...",
  "created_at": "2026-04-22T16:00:00Z",
  "source": {
    "step_index": 3,
    "producer": "browser.screenshot",
    "label": "after-login-home"
  },
  "storage": {
    "mode": "local-file",
    "path": "tasks/ws_01HXYZ/artifacts/homepage.png"
  },
  "access": {
    "download_url": "/api/workstation/artifact/art_01J.../download",
    "preview_url": "/api/workstation/artifact/art_01J.../preview",
    "expires_at": "2026-04-29T16:00:00Z"
  }
}
```

### Required fields
- `artifact_id`
- `task_id`
- `kind`
- `name`
- `mime`
- `size_bytes`
- `sha256`
- `created_at`
- `storage.mode`
- `access.download_url`

### Optional fields
- `source.step_index`
- `source.producer`
- `source.label`
- `access.preview_url`
- `access.expires_at`
- image/video/pdf dimensions or page count in future

---

## 4. Supported artifact kinds (Phase 2)

Initial `kind` enum:
- `screenshot`
- `pdf`
- `download`
- `document`
- `archive`
- `text`
- `json`

Examples:
- browser screenshot → `screenshot`
- exported report PDF → `pdf`
- downloaded csv/xlsx/zip → `download`
- generated markdown/txt → `text`
- structured machine output → `json`

---

## 5. Storage decision

## Phase 2 default
Use **local workstation artifact store** first, not base64 inline and not B2-by-default.

### Recommended default path
```text
/var/lib/workstation/artifacts/<task_id>/<artifact_id>-<safe_name>
```

If containerized, mount a persistent host volume such as:
```text
/opt/workstation-data/artifacts/<task_id>/...
```

### Why local-file first
- simplest implementation
- no object-storage dependency
- easy SHA verification
- easy TTL cleanup
- enough for current single-station Phase 2

### Not Phase 2 default
- `base64 inline` ❌ too heavy / noisy
- `B2 object storage` ❌ useful later, not required now

### Future storage modes
Allow `storage.mode` enum to grow later:
- `local-file` (Phase 2 default)
- `object-store`
- `inline-text`

---

## 6. Access pattern

## 6.1 Download endpoint

```http
GET /api/workstation/artifact/:artifact_id/download
Authorization: Bearer ***
```

Returns raw bytes with:
- correct `Content-Type`
- `Content-Length`
- `Content-Disposition: attachment; filename="..."`
- optional `X-Artifact-SHA256`

## 6.2 Preview endpoint

```http
GET /api/workstation/artifact/:artifact_id/preview
Authorization: Bearer ***
```

Preview is only for browser-safe formats:
- `image/png`
- `image/jpeg`
- `application/pdf`
- `text/plain`
- `application/json`

If preview unsupported:
- return `415 ws_preview_unsupported`

## 6.3 Artifact listing via task poll
`GET /api/workstation/task/:id` remains the place where callers discover artifact metadata.

---

## 7. Size policy

### Phase 2 limits
- `max_artifact_size_mb`: default `100`
- reject larger files with `413 ws_artifact_too_large`
- `result.artifacts[]` metadata always returned even if a later preview is denied

### Inline policy
No binary inline artifacts in Phase 2.
Potential future exception:
- tiny text/json under `32 KB`
- only if caller explicitly requests `inline_small_artifacts=true`

---

## 8. Retention / cleanup

### Default TTL
- retain artifacts for **7 days** after task completion

### Required fields
`access.expires_at` should be returned so caller knows the retention window.

### Cleanup job
A periodic cleanup process should:
- delete expired artifact files
- remove stale metadata rows/entries
- leave task summary intact even after artifact expiry

---

## 9. Caller contract

Caller flow:
1. submit workstation task
2. poll task until terminal state
3. inspect `result.artifacts[]`
4. download/preview only the needed files
5. do not assume artifact bytes are inline

### Caller must not assume
- local workstation filesystem access
- stable absolute file paths
- artifact permanence beyond TTL

Caller may assume:
- `artifact_id` is stable within TTL
- `download_url` works with same bearer token
- `sha256` can be used for integrity verification

---

## 10. Minimal Phase 2 smoke case

### Target smoke
"Open Chrome → capture homepage screenshot → return PNG"

Expected terminal task result:

```json
{
  "task_id": "ws_...",
  "status": "completed",
  "result": {
    "changed_files": [],
    "test_result": "n/a",
    "blocker": null,
    "next_step": null,
    "artifacts": [
      {
        "artifact_id": "art_...",
        "kind": "screenshot",
        "name": "homepage.png",
        "mime": "image/png",
        "size_bytes": 45231,
        "sha256": "...",
        "access": {
          "download_url": "/api/workstation/artifact/art_.../download",
          "preview_url": "/api/workstation/artifact/art_.../preview",
          "expires_at": "2026-04-29T16:00:00Z"
        }
      }
    ]
  }
}
```

Success criteria:
- task completes
- screenshot metadata appears in poll response
- preview endpoint returns `200 image/png`
- downloaded bytes hash matches `sha256`

---

## 11. Security boundary

- artifact endpoints require same bearer token as task polling
- artifact IDs must be unguessable
- do not expose raw host filesystem paths to caller
- sanitize filenames before storage and response
- preview only safe mime types
- enforce TTL cleanup for sensitive outputs

If future multi-user mode lands, artifact ownership must be bound to task owner/token scope.

---

## 12. Recommended implementation order

1. local artifact store on host volume
2. artifact metadata object in task result
3. `/download` endpoint
4. `/preview` endpoint for png/jpg/pdf/text/json
5. TTL cleanup job
6. optional object-store backend later if needed

---

## 13. Open questions for CC1 / CCOC cross-check

1. Is host artifact root better under `/opt/workstation-data/artifacts` or another existing runtime path?
2. Should metadata live only in task JSON store, or also in a lightweight artifact index table/file?
3. Is `100 MB` enough for first real browser/PDF/download use cases?
4. Do we want `project_id`-scoped shared artifact folders later, or always task-scoped?

---

## 14. Draft decision summary

- **Default storage**: local persistent file store
- **Default transfer**: metadata in poll response, bytes via authenticated download endpoint
- **No base64 binary inline** in Phase 2
- **Preview supported** for safe mime subset only
- **Retention**: 7-day TTL
- **Smoke target**: screenshot return path first
