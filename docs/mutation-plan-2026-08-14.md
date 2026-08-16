# Phased Live Mutation Plan — `<DEVELOPMENT_SANDBOX>`

**Status: PROPOSED. Nothing in this document has been executed.**

**Date:** 2026-08-14
**Target:** `<DEVELOPMENT_SANDBOX>` (type `development`, state `active`) in <IMS_ORG_NAME>
**Baseline:** [`live-validation-palm-2026-08-14.md`](./live-validation-palm-2026-08-14.md)

Every phase requires **separate, explicit approval from Dave**. Approving Phase 1 approves Phase 1 only.

---

## The constraint that shapes everything: this is a SHARED sandbox

Adobe describes `<DEVELOPMENT_SANDBOX>` as the **shared** AEP development sandbox. It already contains **20 datasets this project did not create**. Other Adobe partners may be working in here.

That converts "be careful" into hard rules:

| Rule | Why |
|---|---|
| **Touch only objects we created in the same session** | Any pre-existing object may belong to another partner |
| **Every created object is named `mcpval-2026-08-14-<uuid>-<purpose>`** | Makes ours unambiguous and trivially greppable |
| **`datasetId: "ALL"` is permanently forbidden** | It targets every dataset in the *organization* — in a shared sandbox that reaches other partners' data. Not a judgement call, a prohibition |
| **The 20 pre-existing datasets are never a target** | Recorded before Phase 1 and re-checked after every phase |
| **Clean up what we create** | This is someone else's working environment too |

---

## Preconditions for any phase

| # | Precondition | Current |
|---|---|---|
| 1 | Six read-only probes return 200 | **Met** |
| 2 | `resolveSandbox()` returns `development` from `adobe-api` | **Met** |
| 3 | Pre-existing dataset inventory captured | **Not yet — Phase 0** |
| 4 | `AEP_ALLOW_MUTATIONS=true` set for the session only, removed after | Not set |
| 5 | Dave's explicit approval for **this specific phase** | Outstanding |

---

## Phase 0 — Inventory (READ-ONLY, no approval needed)

Capture the exact ids of all 20 pre-existing datasets to a local file before anything is created.

**Why first:** without a recorded baseline there is no way to prove afterwards that we touched nothing pre-existing. This is the evidence that makes every later claim checkable.

- **Operations:** `aep_list_datasets` (GET only)
- **Expected:** 200, 20 datasets
- **Risk:** none
- **Cleanup:** none

---

## Phase 1 — Local dry run and a created dataset (REVERSIBLE)

**Approval required.**

### 1a. Dataset-expiration dry run — sends nothing

- **Tool:** `aep_create_dataset_expiration` with `dryRun: true`
- **Network:** **none.** Verified by test: `dryRun` returns the request that *would* be sent and does not call the client at all
- **Expected:** `sent: false`, plus a `wouldSend` object showing `POST /data/core/hygiene/ttl` with `datasetId` in the body
- **Risk:** zero
- **Cleanup:** none

This is the corrected behaviour. Until today `dryRun` sent a real `PUT` with an undocumented `?dryRun=true`; Adobe documents no dry-run mode, so that would likely have created a **real** expiration. See §"What changed today".

### 1b. Create one disposable dataset

- **Tool:** `aep_create_dataset`
- **Name:** `mcpval-2026-08-14-<uuid>-phase1`
- **Expected:** 201/200 with a new dataset id
- **Risk:** **Low.** Creates a new object; touches nothing existing
- **Rollback:** `aep_delete_dataset` on that id — the only id we will ever pass to a delete tool
- **Cleanup:** delete at end of phase, then re-run Phase 0 and confirm the count is back to 20

**Gate to proceed:** dataset created, then deleted, and the pre-existing 20 are byte-identical in id and count.

---

## Phase 2 — Batch ingestion, abandonable (REVERSIBLE until 2c)

**Separate approval required.**

Against a Phase-1-style dataset created for this phase only.

| Step | Tool | Risk | Rollback |
|---|---|---|---|
| 2a | `aep_create_batch` | Very low — an uncompleted batch processes nothing | Abandon; Adobe reaps it |
| 2b | `aep_upload_batch_file` — 3 synthetic records | Very low — still not completed | Abandon |
| 2c | `aep_complete_batch` | **Low-medium. First irreversible step** — data enters the lake | Record delete (30-day SLA) — see Phase 4 |
| 2d | `aep_get_batch_status` until terminal | None | — |
| 2e | `aep_list_batches` — confirm ours appears | None | — |

**2c is the point of no return for this phase.** Everything before it can be walked away from. Stop and re-confirm before it.

Synthetic records only: no real identities, no customer data, values obviously fake (`mcpval-2026-08-14-<uuid>@focusgts-invalid.test`).

**Cleanup:** delete the dataset created for this phase, which removes the ingested data with it.

---

## Phase 3 — Dataset expiration, for real (REVERSIBLE)

**Separate approval required.**

| Step | Tool | Detail |
|---|---|---|
| 3a | `aep_create_dataset_expiration` | On a **Phase-3-created** dataset only. Far-future expiry (2030). Requires `confirm` phrase |
| 3b | `aep_list_dataset_expirations` | Confirm ours is listed |
| 3c | `aep_delete_dataset_expiration` | Cancel it |
| 3d | `aep_list_dataset_expirations` | Confirm it is gone |

- **Risk:** Medium — schedules a deletion, but of our own throwaway dataset, years out, and cancelled immediately
- **Rollback:** 3c. If 3c fails, the expiry is still years away and the dataset is ours
- **This is also the first live test of the corrected POST shape.** If Adobe rejects it, we learn the documented shape is wrong before it matters

---

## Phase 4 — Record delete (IRREVERSIBLE — its own approval, taken last)

**Separate approval required, requested only after Phases 1–3 have all succeeded.**

This phase is deliberately isolated. It is the only irreversible operation in the plan.

| Property | Value |
|---|---|
| Tool | `aep_create_record_delete` |
| Scope | **One dataset id we created.** Never `"ALL"` |
| Identity | Synthetic only — `mcpval-2026-08-14-<uuid>@focusgts-invalid.test` |
| Expected | 202 with a work order id |
| Rollback | **None. The data is gone** |
| SLA | Up to 30 days (15 with Shield) — completion cannot be observed in-session |

**Why it is worth doing at all:** it is the only way to live-validate the `namespacesIdentities` payload fix, which was wrong until 2026-08-11 and would have failed against any tenant. A green test suite did not catch it; only a real call will confirm it.

**Why it is last:** irreversible, slow, and in a shared sandbox. Every cheaper way of building confidence is exhausted first.

**Hard preconditions:**
1. Phases 1–3 all passed
2. The target dataset was created by us in this phase and contains only synthetic records
3. Dave approves this phase specifically, with the identity value stated in the approval
4. `datasetId` is a literal id — a guard rejects `"ALL"` before the call

---

## What changed today, and why it matters to this plan

Three defects were found while validating the plan's own assumptions. Each would have caused real damage.

### 1. `dryRun` was not a dry run

`aep_create_dataset_expiration` advertised `dryRun` as a safe preview but issued a real mutating request with `?dryRun=true` appended. **Adobe documents no dry-run mode for dataset expiration**, and servers ignore query parameters they do not recognise — so the "safe first step" I recommended yesterday would likely have scheduled the permanent deletion of a real dataset. In a shared sandbox.

Now: `dryRun` contacts Adobe not at all, returns the request it would send, and says plainly that shape ≠ acceptance. Nine tests, the first of which asserts the network client is never called.

### 2. The endpoint shape was wrong

Adobe documents **`POST /data/core/hygiene/ttl`** with `datasetId` in the **body**. The tool used **`PUT /data/core/hygiene/ttl/{datasetId}`**. Corrected.

### 3. Privacy Service was misclassified

Reported yesterday as "missing entitlement" on a bare `/jobs` 404. With Adobe's documented parameters it returns `404 "Not able to find job data."` — a working service reporting an empty result — and a `400` enumerating 20+ supported regulations when `regulation` is omitted. **Privacy Service is reachable and functioning.** The classifier now inspects 404 bodies instead of assuming.

The pattern across all three: an assumption that looked safe until it was actually checked.

---

## Approval format

Please approve one phase at a time, e.g.:

> Approved: Phase 1 only.

I will run that phase, report results, clean up, and stop for the next approval.
