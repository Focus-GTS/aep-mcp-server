# Validation Matrix

Status of all 53 tools. Updated **2026-08-16** after the live validation programme against the development sandbox (`<DEVELOPMENT_SANDBOX>`).

Read this before describing any capability to a customer. A tool being present in the server is not a claim that it works.

## Status legend

| Status | Means |
|---|---|
| **DOC** | Path, method, and request body verified against current Adobe documentation |
| **MOCK** | Unit tested against a mocked response — request shape, URL construction, error handling |
| **READ** | Live GET executed successfully against a real tenant |
| **WRITE** | Live mutation executed successfully against a development sandbox, with a GET-verified postcondition |

`n/a` means the column does not apply (a read-only tool has no WRITE state).

## Environment these results came from

| | |
|---|---|
| Sandbox | `<DEVELOPMENT_SANDBOX>` — **development**, **active** |
| Org | Held in `.env` as `AEP_ORG_ID`; not recorded here |
| Credential | OAuth Server-to-Server, whitelisted by Adobe 2026-08-14 (case `<ADOBE_CASE_ID>`) |
| Shared? | **Yes.** 32 pre-existing datasets belonging to others. Every mutation was run-tagged, ledgered, and cleaned up. |

The sandbox being shared is the reason several tools below are deliberately gated rather than exercised.

---

## Batch Ingestion (7) — live-validated end to end

The full lifecycle was executed against the live tenant across phases 2A, 2B and 2C: create batch → upload file → complete → ingest → verify → revert → clean up. Zero orphans left behind.

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_batch` | ✅ | ✅ | n/a | ✅ | `POST /data/foundation/import/batches`. Collection is POST-only; `GET` returns `405`, confirmed live. |
| `aep_upload_batch_file` | ✅ | ✅ | n/a | ✅ | `PUT .../batches/{id}/datasets/{ds}/files/{name}`, raw binary. Capped at 100 MB, under Adobe's 256 MB single-PUT threshold. |
| `aep_complete_batch` | ✅ | ✅ | n/a | ✅ | `POST .../batches/{id}?action=COMPLETE`. Irreversible; now behind `dryRun` + confirmation. Verified `loading` → `success`. |
| `aep_get_batch_status` | ✅ | ✅ | ✅ | n/a | Catalog read. Used as the authoritative postcondition for every batch transition. |
| `aep_list_batches` | ✅ | ✅ | ✅ | n/a | Catalog read. |
| `aep_abort_batch` | ✅ | ✅ | n/a | ✅ | `?action=ABORT`. Verified `loading` → `aborted` (phase 2B). |
| `aep_revert_batch` | ✅ | ✅ | n/a | ✅ | `?action=REVERT`. Verified `success` → `inactive` → `deleted` (phase 2C). |

There is no cancel-batch tool. Versions of this document before 2026-08-16 listed an aep&#95;cancel&#95;batch; it has never existed in the registry. (Backticks are omitted deliberately — a test asserts that every backticked tool name in this file is a real registered tool.) Adobe's batch actions are ABORT and REVERT.

**ABORT and REVERT are alternatives, not a sequence.** Calling REVERT on an aborted batch returns `428 ERR-BI-104`. The tools preflight batch state and refuse the wrong one.

## Dataset Expiration (5) — live-validated create / read / update / cancel

Executed in phase 3A. A cancelled TTL remains visible as an audit record; that is expected and is not an orphan.

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_dataset_expiration` | ✅ | ✅ | n/a | ✅ | `POST /data/core/hygiene/ttl`, `datasetId` in the **body**. `displayName` is **required** by Adobe. |
| `aep_get_dataset_expiration` | ✅ | ✅ | ✅ | n/a | `GET /ttl/{ttlId\|datasetId}`, `?include=history` supported. |
| `aep_list_dataset_expirations` | ✅ | ✅ | ✅ | n/a | Used to prove zero run-owned pending/executing TTLs remained. |
| `aep_update_dataset_expiration` | ✅ | ✅ | n/a | ✅ | `PUT /ttl/{ttlId}` — **ttlId only**, a datasetId is refused. Preflights that status is still `pending`. |
| `aep_cancel_dataset_expiration` | ✅ | ✅ | n/a | ✅ | `DELETE /ttl/{ttlId\|datasetId}`. Returns `CANCEL_NOT_CONFIRMED` unless a follow-up GET reads `cancelled`. |

Statuses: `pending` / `executing` / `cancelled` / `completed`.

`dryRun` on these tools is a **purely local** preview. Adobe documents no dry-run mode for dataset expiration; until 2026-08-14 this tool appended an undocumented `?dryRun=true` to a **real** mutating request, which would have scheduled a real deletion. It now sends nothing.

## Record Delete (1) — contract-validated and mock-tested, intentionally NOT live-executed

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_record_delete` | ✅ | ✅ | n/a | ⛔ | **Deliberately never executed.** Work-order creation is on the permanent NEVER list for this shared sandbox. |

⛔ is a policy decision, not a gap in capability. A record-delete work order is **asynchronous, non-cancellable, and may take up to 30 days to complete**. In a sandbox containing 32 datasets owned by other people, there is no version of this that is safely reversible, so it has never been run and should not be run here.

Contract verified against Adobe's Data Lifecycle documentation:

| Element | Verified value |
|---|---|
| Request `action` | `delete_identity` |
| Response `action` | `identity-delete` (differs from the request — do not assert equality) |
| Identity payload | Exactly **one** of `identities` or `namespacesIdentities`. Both → `HTTP 400`, "Identities and NamespacesIdentities are not allowed at the same time" |
| Wire shape | `namespacesIdentities: [{ namespace: { code }, ids: [...] }]`, grouped by namespace |
| Dataset requirement | Must have a primary identity or an `identityMap` |
| Cancellation | **None documented** |
| Statuses | `received` / `validated` / `submitted` / `ingested` / `completed` / `failed` |

Hardening in place (23 unit tests):

- `dryRun` defaults **true** and makes zero network calls.
- `ALL`, `*`, `all`, `prod`, `production`, comma-separated lists, blank and malformed IDs are all **refused**. The schema previously *instructed* the model to pass `ALL` to delete across every dataset in the sandbox.
- Confirmation is bound to the dataset ID **and** a SHA-256 digest of the canonical namespace/identity set: `DELETE RECORDS <datasetId> <digest>`. A confirmation approved for one identity set cannot authorise another.
- Preflight resolves the dataset and its schema and refuses when there is no primary identity (`NO_PRIMARY_IDENTITY`) or when the dataset has an active expiration (`DATASET_HAS_ACTIVE_EXPIRATION`).
- **Raw identity values are never echoed, logged, or returned** — only a count, the namespace names, and the digest.

## Work Orders (2)

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_list_work_orders` | ✅ | ✅ | ✅ | n/a | Live GET succeeds. Returns **0 work orders** — correct, because none have ever been created here. |
| `aep_get_work_order_status` | ✅ | ✅ | ⬜ | n/a | **Unvalidated.** Requires an existing `workorderId`, and no work order exists in this sandbox. Not creating one to obtain an ID. |

## Data Lifecycle Quota (1)

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_get_data_lifecycle_quota` | ✅ | ✅ | ✅ | n/a | `GET /data/core/hygiene/quota`. Live values below. |

```
datasetExpirationQuota                    0 / 10,000
dailyConsumerDeleteIdentitiesQuota        0 / 1,000,000
monthlyConsumerDeleteIdentitiesQuota      0 / 15,000,000
```

Both consumer-delete counters reading zero is independent corroboration that no record-delete work order has ever been issued from this tenant.

## Datasets & Schemas (9)

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_list_datasets` | ✅ | ✅ | ✅ | n/a | |
| `aep_get_dataset` | ✅ | ✅ | ✅ | n/a | |
| `aep_create_dataset` | ✅ | ✅ | n/a | ✅ | Exercised in phases 1b/2A–2C; every dataset created was cleaned up. |
| `aep_delete_dataset` | ✅ | ✅ | n/a | ✅ | Postcondition state machine: a GET is authoritative, never the DELETE response body. Confirmed `DELETE` on a missing id returns `404 NotFoundError`. |
| `aep_list_schemas` | ✅ | ✅ | ✅ | n/a | Pagination uses an **opaque cursor**. `start` is NOT a numeric offset — `start=0` returns nothing. Numeric offsets are now refused. |
| `aep_get_schema` | ✅ | ✅ | ✅ | n/a | |
| `aep_create_schema` | ✅ | ✅ | n/a | ✅ | |
| `aep_update_schema` | ✅ | ✅ | n/a | ⬜ | Not exercised live. |
| `aep_list_dataflows` | ✅ | ✅ | ✅ | n/a | |

## Privacy Service (6) — working access, empty results

Authentication and authorisation both succeed. Every collection returns zero rows because no privacy job has ever been created in this sandbox. **An empty result here is a working endpoint, not a broken one.**

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_list_privacy_jobs` | ✅ | ✅ | ✅ | n/a | 200 OK, empty. |
| `aep_list_privacy_namespaces` | ✅ | ✅ | ✅ | n/a | 200 OK. |
| `aep_get_privacy_job` | ✅ | ✅ | ⬜ | n/a | No job ID exists to fetch. |
| `aep_get_privacy_job_results` | ✅ | ✅ | ⬜ | n/a | No job ID exists to fetch. |
| `aep_create_privacy_job` | ✅ | ✅ | n/a | ⬜ | Not executed — creates a real regulatory job. |
| `aep_cancel_privacy_job` | ✅ | ✅ | n/a | ⬜ | Not executed. |

## Datastreams (5) — experimental, endpoint unsupported

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_list_datastreams` | ⚠️ | ✅ | ❌ | n/a | Returns an **HTML 404** — the endpoint is not served for this tenant. |
| `aep_get_datastream` | ⚠️ | ✅ | ❌ | n/a | As above. |
| `aep_create_datastream` | ⚠️ | ✅ | n/a | ❌ | As above. |
| `aep_update_datastream` | ⚠️ | ✅ | n/a | ❌ | As above. |
| `aep_delete_datastream` | ⚠️ | ✅ | n/a | ❌ | As above. **No confirmation gate** — deliberate, see [ADR-0003](./adr/0003-add-data-collection-datastreams-tools.md). |

An **HTML** body rather than JSON means the request never reached the API service. This is classified as *unsupported / undocumented endpoint*, not as an authentication or entitlement failure, and not as a tool defect — a probe and the tool path were reconciled and now share `paths.ts` with contract tests. **Treat all five as experimental. Do not demo them.**

## Profiles, Segments, Queries, Sources, Destinations (17)

| Group | Tools | Status |
|---|---|---|
| Profile | `aep_get_profile`, `aep_get_profile_by_identity`, `aep_preview_profile`, `aep_get_identity_graph`, `aep_list_identity_namespaces`, `aep_delete_profile` | DOC + MOCK. Reads return empty (no profile data in sandbox); `aep_delete_profile` not executed. |
| Segments | `aep_list_segments`, `aep_get_segment`, `aep_create_segment`, `aep_estimate_segment_size`, `aep_activate_segment` | DOC + MOCK. Not live-exercised. |
| Query Service | `aep_list_queries`, `aep_get_query_status`, `aep_run_query` | DOC + MOCK. Requires Data Distiller; entitlement unconfirmed. |
| Sources / Destinations | `aep_list_sources`, `aep_list_destinations`, `aep_create_destination_connection` | DOC + MOCK. Reads succeed; connection creation not executed. |

---

## Standing operational rules

These are not suggestions. They came out of real incidents during this programme.

1. **A GET is the postcondition. A write response body is not.** Adobe returns 200 with an empty or optimistic body on operations that have not taken effect.
2. **Never run write, delete, ingestion, or hygiene operations against AEP `prod`.** `AEP_SANDBOX_NAME` is required and has no default — it used to default to `prod`.
3. **Work-order creation is permanently forbidden in this shared sandbox.**
4. Every mutation is run-tagged and ledgered, with an ownership assertion before any cleanup deletes anything.
5. Mutating tools require `AEP_ALLOW_MUTATIONS`; `dryRun` defaults to true on the destructive ones.

## Why the earlier version of this file was wrong

Until 2026-08-16 this document opened with "No tool in this table has been exercised against a live Adobe tenant." That was true when written on 2026-08-11 and became false on 2026-08-14. It also listed `aep_create_dataset_expiration` as `PUT /data/core/hygiene/ttl/{id}` with `dryRun` supported — wrong method, wrong path, and a dry-run mode Adobe does not have.

A stale validation matrix is worse than no validation matrix, because it is quoted to customers. Update it in the same change that alters a tool's real status.
