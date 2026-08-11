# Validation Matrix — Batch Ingestion and Data Lifecycle

Status of the 12 Batch Ingestion and Data Hygiene tools. Updated 2026-08-11.

**No tool in this table has been exercised against a live Adobe tenant.** Focus GTS has no AEP sandbox in which mutation is permitted — see "Why nothing is live-validated" below. Nothing here may be described to a customer as live-validated until this file says so.

## Status legend

| Status | Means |
|---|---|
| **DOC** | Path, method, and request body verified against current Adobe documentation |
| **MOCK** | Unit tested against a mocked response — request shape, URL construction, error handling |
| **READ** | Live GET executed successfully against a real tenant |
| **WRITE** | Live mutation executed successfully against a development sandbox |

## Batch Ingestion (6)

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_batch` | ✅ | ⬜ | ⬜ | ⬜ | `POST /data/foundation/import/batches`. Collection is POST-only; `GET` returns `405`, confirmed live. |
| `aep_upload_batch_file` | ✅ | ⬜ | ⬜ | ⬜ | `PUT .../batches/{id}/datasets/{ds}/files/{name}`. Capped at 100 MB, safely under Adobe's 256 MB single-PUT threshold. |
| `aep_complete_batch` | ✅ | ⬜ | ⬜ | ⬜ | `POST .../batches/{id}?action=COMPLETE`. Nothing processes without it. |
| `aep_get_batch_status` | ✅ | ⬜ | ⬜ | n/a | Catalog read. Live `403` on the current credential. |
| `aep_list_batches` | ✅ | ⬜ | ⬜ | n/a | Catalog read. Live `403` on the current credential. |
| `aep_cancel_batch` | ✅ | ⬜ | ⬜ | ⬜ | Not yet re-audited this pass. |

## Data Lifecycle / Hygiene (6)

| Tool | DOC | MOCK | READ | WRITE | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_record_delete` | ✅ | ✅ | ⬜ | ⬜ | **Payload defect found and fixed 2026-08-11** — see below. |
| `aep_create_dataset_expiration` | ✅ | ⬜ | ⬜ | ⬜ | `PUT /data/core/hygiene/ttl/{id}`, `dryRun` supported. Confirmation gate skipped when `dryRun=true`. |
| `aep_get_work_order_status` | ✅ | ⬜ | ⬜ | n/a | Live `401` on the current credential — cause unresolved. |
| `aep_list_work_orders` | ✅ | ⬜ | ⬜ | n/a | Live `401` on the current credential. |
| `aep_list_dataset_expirations` | ✅ | ⬜ | ⬜ | n/a | Live `401` on the current credential. |
| `aep_delete_dataset_expiration` | ✅ | ⬜ | ⬜ | ⬜ | Not yet re-audited this pass. |

## Defects found in this pass

### 1. Record delete sent the wrong payload shape — FIXED

`create-record-delete.ts` sent a flat `identities: [{namespace, id}]` array. Adobe's Data Lifecycle API requires **`namespacesIdentities`** — an array of `{ namespace: { code }, ids: [...] }` grouped by namespace.

The tool would have failed against any live tenant. It was never caught because no live mutation has ever been executed, and the existing unit test asserted on the confirmation gate rather than the wire format.

Fixed by keeping the flat input schema — which is markedly easier for a model to produce correctly — and converting on the way out via `toNamespacesIdentities()`, now covered by 9 unit tests including an explicit assertion that the flat shape can never be emitted.

**This is the strongest available argument for finishing live validation.** A documentation audit found it; a green test suite did not.

### 2. Missing identity cap — FIXED

Adobe accepts at most **100,000 identities** per work order. The schema had no upper bound. Added as a Zod `.max()` with an actionable message.

### 3. The 256 MB concern was overstated — CLOSED, no code defect

Recorded here because the first version of this document called it an open defect. It was not.

`aep_upload_batch_file` caps local files at **100 MB** and inline content at **10 MB**. Both sit safely below Adobe's **256 MB** single-`PUT` threshold, so a single `PUT` is always valid and the chunked flow can never be reached. There was no failure mode.

Two real but smaller problems were fixed instead:

- A source comment claimed Adobe's single-`PUT` ceiling was **512 MB**. The verified figure is **256 MB**. Wrong constants in comments become wrong constants in code the next time someone "raises the limit."
- The over-size error told the caller to split the file without saying that 100 MB is *our* cap rather than Adobe's, or what to do for genuinely large loads. It now distinguishes the two and points at Source connectors or an ETL job for sustained volume.

The tool still does not implement Adobe's chunked upload. That is a deliberate scope decision, not a gap: a file that large should be streamed by an ETL job, not held in memory by an MCP tool serving a model.

## Why nothing is live-validated

The current credential is issued in **Focus GTS Partner Sandbox** (`B0281EAE677E30D40A495CD0@AdobeOrg`) and can only see the `prod` sandbox. Mutation testing against it is prohibited.

The intended target is **`focusgts-ucp`**, a confirmed `development` sandbox in **Exchange Partner Sandbox Charlie**. Blocked on Adobe support case **`SALES0854929`** (related: `SALES0852429`), which requests Developer Console access, product-profile assignment, and Charlie's exact IMS org ID.

Until then: `AEP_ORG_ID` is unknown. The Developer Console org number `267543` is **not** an IMS org ID and must not be used — `scripts/validate-readonly.mjs` refuses to start if `AEP_ORG_ID` does not end in `@AdobeOrg`.

## Order of operations when the credential arrives

1. `cp .env .env.prod-backup` — do not overwrite an existing backup
2. Configure the Charlie credential with `AEP_SANDBOX_NAME=focusgts-ucp`
3. `node scripts/validate-readonly.mjs --env .env.charlie` — **GET only**
4. Confirm Sandbox Management is readable. If it is not, the write guard cannot resolve a sandbox type and will fail closed on every mutation by design.
5. Fill in the READ column above from the probe output
6. **Stop.** Mutation testing requires Dave's explicit authorisation, plus `AEP_ALLOW_MUTATIONS=true`
7. Only then fill in WRITE, one tool at a time, starting with `dryRun` on dataset expiration

## Safety posture

Four independent gates stand between a tool call and a mutation:

1. `AEP_ALLOW_MUTATIONS=true` — writes are off by default
2. Sandbox named `prod`/`production` is refused unconditionally, **before** mode resolution, so `AEP_MODE=production` cannot lift it
3. Write mode (`read-only` / `safe` / `production`)
4. In `safe` mode, Adobe must classify the sandbox as `development`

Gates 1 and 2 are new as of 2026-08-11 and are covered by 31 tests, including every bypass route we could think of. Destructive tools carry their own exact-phrase confirmation gate on top.
