# Live Validation — PALM Development Sandbox (post-whitelist)

**Date:** 2026-08-14
**Target:** `focusgts-ucp` in Exchange Partner Sandbox Charlie
**Org:** `0A7D42FC5DB9D3360A495FD3@AdobeOrg`
**Trigger:** Adobe confirmed the OAuth technical account is whitelisted for the shared AEP PALM sandbox (case `SALES0855734`)
**Supersedes:** [`live-validation-palm-2026-08-12.md`](./live-validation-palm-2026-08-12.md)

Read-only. **No POST, PUT, PATCH, or DELETE was issued.** `AEP_ALLOW_MUTATIONS` was not set. No credential or token value appears in this document or any log.

---

## Verdict

**Access is working. The environment resolves as `development`. The staged mutation plan is ready to run — pending your approval, and with one new constraint: this is a *shared* sandbox.**

---

## 1. Sandbox Management

| Check | Result |
|---|---|
| `GET /data/foundation/sandbox-management/` | **200** |
| `focusgts-ucp` present in the returned array | **Yes** |
| Sandboxes returned | 1 |

Exact values as returned by Adobe:

| Field | Value |
|---|---|
| `name` | `focusgts-ucp` |
| `type` | **`development`** |
| `state` | `active` |
| `isDefault` | `false` |

The previous run returned 200 with `sandboxes: []`. That is now resolved.

## 2. `resolveSandbox()` — the real function, not the raw API

Exercised against the built `dist/`, not inferred from the endpoint:

```
name  : focusgts-ucp
type  : development      <-- was 'unknown'
state : active
source: adobe-api        <-- was 'unresolved'
reason: (none)
```

**The write guard now resolves the environment as `development`.** `safe` mode will therefore permit mutations here once they are explicitly enabled — which is exactly the intended behaviour, and the condition that was blocking.

## 3. Guard still closed

With `AEP_ALLOW_MUTATIONS` unset, as now:

```
mode: safe
POST -> blocked by MutationsDisabledError
```

Gate 1 holds. Resolving the sandbox type did not open the door; it only removed the *second* reason the door was shut.

---

## 4. The six read-only probes

All six now return **200**. Every one was `403` or `401` on 2026-08-12.

| # | Endpoint | 08-12 | **08-14** | Classification |
|---|---|:--:|:--:|---|
| 1 | `schemaregistry/tenant/schemas?limit=1` | 403 | **200** | Working access |
| 2 | `catalog/dataSets?limit=1` | 403 | **200** | Working access |
| 3 | `catalog/batches?limit=1` | 403 | **200** | Working access |
| 4 | `core/hygiene/workorder` | 401 | **200** | Working access (empty collection) |
| 5 | `core/hygiene/ttl` | 401 | **200** | Working access (empty collection) |
| 6 | `core/ups/segment/definitions?limit=1` | 401 | **200** | Working access (empty collection) |

Empty collections on 4–6 are expected in a sandbox with no work orders, expirations, or audiences yet. Classified as `VALID EMPTY RESPONSE`, deliberately distinct from "working access with data" — the distinction that was missing when a `sandboxes: []` was read as success.

### Two non-required surfaces

| Endpoint | Status | Content type | Classification |
|---|:--:|---|---|
| `/data/core/edge/datastreams` | **404** | **HTML** | **Unsupported or undocumented endpoint** — Adobe's, not ours |
| `/data/core/privacy/jobs?regulation=gdpr` | **404** | JSON | Missing entitlement |

---

## 5. The datastream result is now conclusive

This is the significant new finding.

On 2026-08-12 the HTML 404 was ambiguous — the credential could reach almost nothing, so a routing failure and an access failure looked alike. **That ambiguity is gone.** With full working access to every other surface in this sandbox, `/data/core/edge/datastreams` still returns an HTML 404.

An HTML body means the request never reached an AEP service. It is not a permissions problem, and it is no longer explicable as one.

Combined with the documentation finding — Adobe publishes no REST API for datastream configuration ([investigation note](./datastream-endpoint-investigation-2026-08-12.md)) — the conclusion is that **this endpoint does not exist as we call it.**

Per the instruction recorded in `src/tools/datastreams/paths.ts`: escalate to Adobe for the supported API rather than guessing another path. **Recommended addition to the support case: ask Adobe whether a datastream configuration REST API exists and, if so, for its host and path.**

All five datastream tools are now marked **`EXPERIMENTAL — UNSUPPORTED ENDPOINT`** in their descriptions, and issue [`001-datastream-api-documentation-gap`](./issues/001-datastream-api-documentation-gap.md) is open.

Privacy Service was reclassified after retesting with documented parameters — see the addendum.

---

## 6. MCP tools live-confirmed

Invoked through the real registered handlers with Zod defaults applied, exactly as the MCP SDK does.

**13 tools confirmed working against a live tenant:**

| Tool | Result |
|---|---|
| `aep_list_datasets` | 200 — **20 datasets** |
| `aep_get_dataset` | 200 — fetched by a real id harvested from the list |
| `aep_list_schemas` | 200 — 0 tenant schemas |
| `aep_list_batches` | 200 |
| `aep_list_segments` | 200 — 0 |
| `aep_list_work_orders` | 200 — 0 |
| `aep_list_dataset_expirations` | 200 — 0 |
| `aep_list_queries` | 200 |
| `aep_list_sources` | 200 |
| `aep_list_destinations` | 200 |
| `aep_list_dataflows` | 200 |
| `aep_list_identity_namespaces` | 200 |
| `aep_list_privacy_namespaces` | 200 |

**1 failed:** `aep_list_datastreams` — `AEP_404`, the undocumented endpoint above.

**13 skipped:** every `get_*` requiring an id that does not exist in an empty sandbox (`aep_get_schema`, `aep_get_segment`, `aep_get_work_order_status`, profile and identity lookups, `aep_list_privacy_jobs`). Not failures — nothing to fetch. Most become testable once the mutation plan creates seed data.

### A correction to my own method

My first pass called handlers with raw `{}`, bypassing Zod, and reported `aep_list_schemas` as a **400 failure**. That was my harness's defect: `containerType` has `.default("tenant")`, and without Zod the path became `/schemaregistry/undefined/schemas`. Re-run correctly, the tool returns 200. **No product bug existed.** Recording it because a harness that bypasses the framework's validation will keep inventing failures.

---

## 7. Remaining failures, classified

| Surface | Class | Owner |
|---|---|---|
| `/data/core/edge/datastreams` | **Unsupported or undocumented endpoint** | Adobe — ask for the supported API |
| `/data/core/privacy/jobs` | **Working access, empty result** — reclassified 2026-08-14 | nobody |

**Zero** remaining as missing sandbox membership. **Zero** as missing product-profile permission. **Zero** as our implementation error.

---

## 8. Readiness for staged mutation validation

**Ready — with one new constraint that changes the plan.**

| Precondition | Status |
|---|---|
| All six probes return 200 | **Met** |
| Sandbox Management lists `focusgts-ucp` | **Met** |
| `resolveSandbox()` reports `development`, source `adobe-api` | **Met** |
| Write guard fails closed while mutations are disabled | **Met** |
| Dave's explicit approval | **Outstanding** |

### The new constraint: this is a SHARED sandbox

Adobe described it as the *shared* AEP PALM sandbox, and the sandbox already contains **20 datasets** this project did not create. Other partners may be working in here.

That tightens the mutation plan in three ways:

1. **Never mutate a pre-existing object.** Every write targets a resource we created in the same session, carrying the `mcpval-<date>-<uuid>` prefix.
2. **`datasetId: "ALL"` is absolutely forbidden** — it was already barred, but in a shared sandbox a record delete scoped to ALL would reach other partners' data. This alone justifies keeping step 8 behind its own separate approval.
3. **Create, then clean up.** Anything created should be removed once verified, rather than left as litter in an environment other people use.

### Recommended first step when approved

`aep_create_dataset_expiration` with `dryRun=true`. Adobe validates and discards; nothing is created; it exercises the full auth, guard, and request-shape path with zero blast radius. It is also the only write in the plan that is genuinely reversible by doing nothing.

---

## 9. Repository state

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| Test suite | **228 passed**, 16 files |
| `AEP_ALLOW_MUTATIONS` | Not set |
| Mutations executed | **None** |


---

## Addendum — 2026-08-14, three corrections

### Privacy Service was misclassified. It works.

Retested with Adobe's documented parameters, `GET /data/core/privacy/jobs?regulation=gdpr&size=1`:

```
404 application/json
{"errorCode":404,"title":"Resource not found",
 "detail":"Not able to find job data.","errorType":"uri=/data/core/privacy/jobs"}
```

And with `regulation` omitted:

```
400 {"errorCode":400,"title":"Invalid Request",
     "detail":"The `regulation` parameter is mandatory. Supported values:
     [vcdpa_usa, gdpr, ccpa, lgpd_bra, cpra_usa, apa_aus, hipaa_usa, ...]"}
```

That is a live service validating input and reporting that nothing matched. **Not an entitlement gap.** The earlier call omitted `regulation`, and a bare `/jobs` 404 was never sufficient evidence.

Reclassified to **working access, empty result**. The classifier now inspects 404 bodies rather than assuming, distinguishing "not able to find" from "not authorized / not provisioned". Four regression tests.

### The datastream endpoint is confirmed unsupported

No change to the finding, but the tools are downgraded from "undocumented, pending" to **EXPERIMENTAL — UNSUPPORTED ENDPOINT**, and issue [`001-datastream-api-documentation-gap`](./issues/001-datastream-api-documentation-gap.md) is open with a specific question for Adobe. The path was **not** changed.

### `dryRun` was never a dry run — safety-critical

`aep_create_dataset_expiration` sent a real mutating request with `?dryRun=true`. Adobe documents no dry-run mode, and the endpoint shape was wrong as well: Adobe uses **`POST /data/core/hygiene/ttl`** with `datasetId` in the body; the tool used **`PUT .../ttl/{datasetId}`**.

Had the PUT form worked, a "dry run" would have scheduled the **permanent deletion of a real dataset** in a shared sandbox. `dryRun` is now a purely local preview that contacts Adobe not at all. Nine tests, the first asserting the client is never called.

**This invalidated the recommendation in §8 above.** Dataset expiration with `dryRun=true` was proposed as the zero-risk first step. It was not zero-risk; it was the most dangerous step in the plan while still being labelled safe.
