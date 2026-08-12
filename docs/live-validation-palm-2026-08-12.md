# Live Validation — PALM Development Sandbox

**Date:** 2026-08-12
**Target:** `focusgts-ucp` (type `development`) in Exchange Partner Sandbox Charlie
**Org:** `0A7D42FC5DB9D3360A495FD3@AdobeOrg` (alias `exchangesandboxcharlie`)
**Credential:** Developer Console project *Focus GTS AEP MCP PALM Dev* → *Focus GTS AEP MCP PALM Dev OAuth* (Server-to-Server)
**Product profile:** `AEP-Default-All-Users`
**Attached APIs:** Experience Platform API, Adobe Journey Optimizer

No credential value appears in this document. No write, delete, ingestion, or lifecycle request has been executed.

---

## STATUS: BLOCKED ON CREDENTIAL INSTALLATION

The live probes below have **not been run**. The OAuth client ID and secret must be copied from Adobe Developer Console into the local `.env` by a human — they are deliberately never requested in chat and cannot be retrieved by this repository's tooling.

Everything not requiring a credential is complete. See "Handoff" at the end.

---

## Pre-flight, completed

### Credential hygiene

| Check | Result |
|---|---|
| `.gitignore` covers every `.env` variant | Yes — `.env`, `.env.*`, with `!.env.example` as the sole exception |
| Anything env-ish tracked by git | Only `.env.example` |
| `.env.prod-backup` already exists | **Yes** — 2026-08-08, 184 bytes |
| `.env` identical to the backup | **Yes**, verified by `cmp` exit status without reading either file |

**The backup was NOT overwritten.** The standing instruction is not to overwrite an existing `.env.prod-backup`, and since `.env` and the backup are byte-identical, the production credential is already preserved. Running `cp .env .env.prod-backup` would have been a no-op at best and destructive at worst.

### Repository state

| Check | Result |
|---|---|
| Typecheck | Clean |
| Test suite | **176 passed**, 13 files |
| Published version | v0.7.0 on npm with SLSA provenance |

Note on versioning: the brief refers to v0.4.0. The repository is at **v0.7.0**. The tool counts referenced (12 Batch Ingestion + Data Hygiene tools) are accurate; the version number is stale.

---

## The six probes — AWAITING CREDENTIAL

Run with:

```bash
node scripts/validate-readonly.mjs --env .env
```

`GET`-only, hard-asserted against non-GET methods. Refuses to run if `AEP_SANDBOX_NAME` is `prod`. Prints a credential preflight showing only lengths and a masked prefix.

| # | Endpoint | Accept | Status | Classification |
|---|---|---|:--:|---|
| 1 | `/data/foundation/schemaregistry/tenant/schemas?limit=1` | `application/vnd.adobe.xed-id+json` | — | pending |
| 2 | `/data/foundation/catalog/dataSets?limit=1` | default | — | pending |
| 3 | `/data/foundation/catalog/batches?limit=1` | default | — | pending |
| 4 | `/data/core/hygiene/workorder` | default | — | pending |
| 5 | `/data/core/hygiene/ttl` | default | — | pending |
| 6 | `/data/core/ups/segment/definitions?limit=1` | default | — | pending |

Plus one diagnostic not in the brief but load-bearing:

| # | Endpoint | Why it matters |
|---|---|---|
| 7 | `/data/foundation/sandbox-management/` | The write guard resolves sandbox **type** from this. If it 403s, `safe` mode cannot confirm `focusgts-ucp` is `development` and will **fail closed on every mutation** — which would block write testing regardless of any other permission. |

### Classification key

| Verdict | Meaning | Who fixes it |
|---|---|---|
| **WORKING ACCESS** | 2xx | — |
| **MISSING PRODUCT-PROFILE PERMISSION** | 403 | Adobe admin, Admin Console, minutes |
| **MISSING PERMISSION OR ENTITLEMENT** | 401 | Check org/sandbox/profile first; entitlement last |
| **ROUTE EXISTS, NOT PROVISIONED** | JSON 404 | Usually entitlement |
| **IMPLEMENTATION ERROR** | HTML 404, 405, 400 | **Us** — our code is wrong |

A `401` is **not** to be reported as a missing SKU. On the previous credential, Hygiene `401`s were attributed to missing Data Distiller; that attribution was retracted. Adobe's Data Lifecycle documentation names no licensing prerequisite, these capabilities can come with standard RTCDP/AJO/CJA entitlements, and Data Lifecycle is confirmed working in this org's UI. Order the hypotheses: wrong org, wrong sandbox, wrong product profile, then entitlement.

---

## Validation matrix — 12 Batch Ingestion and Data Lifecycle tools

Legend: **DOC** documentation-verified · **MOCK** unit-tested against a mock · **READ** live GET succeeded · **WRITE** live mutation succeeded

### Batch Ingestion (6)

| Tool | DOC | MOCK | READ | WRITE | Note |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_batch` | ✅ | ⬜ | n/a | ⬜ | `POST /data/foundation/import/batches`; collection is POST-only |
| `aep_upload_batch_file` | ✅ | ⬜ | n/a | ⬜ | 100 MB cap, under Adobe's 256 MB single-PUT threshold |
| `aep_complete_batch` | ✅ | ⬜ | n/a | ⬜ | `?action=COMPLETE`; nothing processes without it |
| `aep_get_batch_status` | ✅ | ⬜ | ⏳ | n/a | Probe 3 covers the Catalog surface |
| `aep_list_batches` | ✅ | ⬜ | ⏳ | n/a | Probe 3 |
| `aep_cancel_batch` | ✅ | ⬜ | n/a | ⬜ | Not re-audited this pass |

### Data Lifecycle / Hygiene (6)

| Tool | DOC | MOCK | READ | WRITE | Note |
|---|:--:|:--:|:--:|:--:|---|
| `aep_create_record_delete` | ✅ | ✅ | n/a | ⬜ | Payload defect fixed in v0.7.0 — `namespacesIdentities`, not flat `identities` |
| `aep_create_dataset_expiration` | ✅ | ⬜ | n/a | ⬜ | Supports `dryRun`; the safest first write |
| `aep_get_work_order_status` | ✅ | ⬜ | ⏳ | n/a | Probe 4 |
| `aep_list_work_orders` | ✅ | ⬜ | ⏳ | n/a | Probe 4 |
| `aep_list_dataset_expirations` | ✅ | ⬜ | ⏳ | n/a | Probe 5 |
| `aep_delete_dataset_expiration` | ✅ | ⬜ | n/a | ⬜ | Not re-audited this pass |

---

## Write / delete test plan — REQUIRES EXPLICIT APPROVAL

Not executed. Presented for approval per instruction 5.

### Preconditions, all required

1. All six probes return **WORKING ACCESS**, or their failures are understood
2. `/data/foundation/sandbox-management/` returns 200 **and** reports `focusgts-ucp` as type `development` — otherwise `safe` mode fails closed
3. `AEP_SANDBOX_NAME=focusgts-ucp` confirmed, never `prod`
4. `AEP_ALLOW_MUTATIONS=true` set deliberately for the session, removed afterwards
5. Dave's explicit go-ahead, per operation class

### Naming convention

Every temporary resource carries a unique, obviously-disposable name:

```
mcpval-2026-08-12-<short-uuid>-<purpose>
```

Nothing is created without that prefix. It makes orphans trivially greppable and unambiguous to clean up.

### Sequence, least to most destructive

| # | Operation | Tool | Risk | Rollback |
|---|---|---|---|---|
| 1 | Dataset expiration with `dryRun=true` | `aep_create_dataset_expiration` | **None** — Adobe validates and discards | Nothing created |
| 2 | Create an empty batch, never complete it | `aep_create_batch` | Very low — an uncompleted batch processes nothing | Abandon; Adobe reaps it |
| 3 | Upload a 3-record JSONL file to that batch | `aep_upload_batch_file` | Very low — still not completed | Abandon |
| 4 | Complete the batch | `aep_complete_batch` | **Low-medium — first irreversible step.** Data enters the lake | Record delete (30-day SLA) |
| 5 | Read batch status until terminal | `aep_get_batch_status` | None | — |
| 6 | Create a dataset expiration for real, far-future date | `aep_create_dataset_expiration` | Medium — schedules a deletion | `aep_delete_dataset_expiration` |
| 7 | Cancel that expiration | `aep_delete_dataset_expiration` | Low | — |
| 8 | Record delete against a synthetic identity only | `aep_create_record_delete` | **HIGH — irreversible, 30-day SLA** | **None** |

### Hard constraints

- **Step 8 needs its own separate approval**, taken after 1–7 have all succeeded. It is irreversible and slow, and it is the only way to live-validate the `namespacesIdentities` fix.
- Its identity must be **synthetic and unique** — e.g. `mcpval-2026-08-12-<uuid>@focusgts-invalid.test` — never a real person, never a real customer identifier.
- `datasetId: "ALL"` is **forbidden** in every step. It targets every dataset in the organization.
- Step 4 is the point of no return for ingestion. Everything before it is abandonable.
- Target a **purpose-created dataset**, never a pre-existing one.

---

## Handoff — what Dave must do

The client ID and secret cannot be retrieved by this repository's tooling and are deliberately never requested in chat.

1. Open Adobe Developer Console → **Focus GTS AEP MCP PALM Dev** → **OAuth Server-to-Server**
2. Edit `.env` directly (it is git-ignored; `.env.prod-backup` already preserves production) so it reads:

```dotenv
AEP_CLIENT_ID=<paste from Developer Console>
AEP_CLIENT_SECRET=<paste from Developer Console>
AEP_ORG_ID=0A7D42FC5DB9D3360A495FD3@AdobeOrg
AEP_SANDBOX_NAME=focusgts-ucp
LOG_LEVEL=info
```

**`AEP_SANDBOX_NAME` is not optional.** If it is missing, `loadCredentials()` defaults it to `"prod"` — see the open issue below.

Do **not** add `AEP_ALLOW_MUTATIONS` yet. Reads do not need it, and its absence is what keeps this session read-only.

3. Say the word, and the six probes run.

---

## Open issue found during this pass

`src/auth/credentials.ts` defaults `AEP_SANDBOX_NAME` to `"prod"` when the variable is absent:

```ts
sandboxName: process.env.AEP_SANDBOX_NAME ?? "prod",
```

A `.env` that omits the line silently targets production. The v0.7.0 gates blunt the consequences — a sandbox named `prod` is refused for all mutations — but **reads still go to production silently**, and the default contradicts the principle the rest of the codebase follows.

Recommended: make `AEP_SANDBOX_NAME` required, and fail with a clear message. Not changed in this pass because it is a breaking change and was not in scope.

---

## Answers to the closing questions

| Question | Answer |
|---|---|
| The six HTTP codes | **Not yet obtained** — credential not installed |
| MCP tools confirmed working | **None live-confirmed.** 176 unit/integration tests pass, which is not the same thing |
| Tools blocked | All 12, pending the credential |
| Adobe permissions still required | Unknown until the probes run. Known outstanding: CJA and Adobe Analytics API project creation is disabled for Dave in Developer Console — an Adobe permission issue, out of scope for this repo |
| Is the release ready for safe live mutation testing? | **The code is ready. The evidence is not.** Four independent gates plus per-tool confirmation phrases are in place and tested. But no live call has ever succeeded against this org, so the answer stays no until at least the six probes pass and Sandbox Management confirms `focusgts-ucp` as `development` |
