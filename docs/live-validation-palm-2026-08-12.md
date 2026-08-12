# Live Validation — PALM Development Sandbox

**Date:** 2026-08-12
**Target:** `focusgts-ucp` in Exchange Partner Sandbox Charlie (`exchangesandboxcharlie`)
**Credential:** Developer Console → *Focus GTS AEP MCP PALM Dev* → OAuth Server-to-Server
**Product profile:** `AEP-Default-All-Users`
**Attached APIs:** Experience Platform API, Adobe Journey Optimizer

Read-only. **No write, ingestion, lifecycle, or delete request was executed.** `AEP_ALLOW_MUTATIONS` was not set. No credential or token value appears in this document, in any log, or in any committed artifact.

---

> **Blocked on Adobe support case `SALES0855734`** (submitted 2026-08-12), which asks Adobe to assign the OAuth technical account to the `focusgts-ucp` development sandbox, grant View Sandboxes, grant the AEP/AJO product-profile permissions, confirm entitlements, and failing that give Dave administrative access.
>
> **The credential secret is pending rotation.** Do not re-run the harness until Dave confirms the replacement is installed.

## Verdict

**Not ready for mutation validation.** The credential authenticates but is a member of **zero sandboxes**, and every AEP data surface tested is gated. This is an Adobe permissions problem, not a code defect — with one exception, a wrong endpoint path of ours, detailed below.

---

## 1. Credential preflight

Presence and expected-value match only. No lengths, no prefixes, no derived values.

| Variable | Result |
|---|---|
| `AEP_CLIENT_ID` | present |
| `AEP_CLIENT_SECRET` | present |
| `AEP_ORG_ID` | matches expected Charlie org |
| `AEP_SANDBOX_NAME` | matches expected `focusgts-ucp` |

IMS token acquisition **succeeded**. The credential is valid and the org is correct.

---

## 2. The six required endpoints

| # | Endpoint | Status | Classification |
|---|---|:--:|---|
| 1 | `/data/foundation/schemaregistry/tenant/schemas?limit=1` | **403** | Missing product-profile permission |
| 2 | `/data/foundation/catalog/dataSets?limit=1` | **403** | Missing product-profile permission |
| 3 | `/data/foundation/catalog/batches?limit=1` | **403** | Missing product-profile permission |
| 4 | `/data/core/hygiene/workorder` | **401** | Missing permission or entitlement — unresolved |
| 5 | `/data/core/hygiene/ttl` | **401** | Missing permission or entitlement — unresolved |
| 6 | `/data/core/ups/segment/definitions?limit=1` | **401** | Missing permission or entitlement — unresolved |

Redacted response summaries:

| # | Summary |
|---|---|
| 1 | `Permission management access denied` |
| 2 | `ForbiddenError` |
| 3 | `ForbiddenError` |
| 4 | `Access Denied. The user is not authorized to make the request.` |
| 5 | `Access Denied. The user is not authorized to make the request.` |
| 6 | `Unauthorized` |

No response bodies were logged or retained beyond these one-line titles. No tenant data was captured.

**On the three 401s:** these are *not* reported as missing entitlements. Adobe's Data Lifecycle documentation names no licensing prerequisite, Dave has confirmed UI access to Data Lifecycle and audiences in this org, and the credential is a member of no sandboxes at all. The far more likely cause is product-profile scope. Entitlement remains the last hypothesis, not the first.

---

## 3. Sandbox Management — reported separately

| Endpoint | Status | Result |
|---|:--:|---|
| `/data/foundation/sandbox-management/` | **200** | Returns `sandboxes: []` — **empty** |
| `/data/foundation/sandbox-management/sandboxes` | **403** | `SMS-2010-403` |
| `/data/foundation/sandbox-management/sandboxes/focusgts-ucp` | **403** | `SMS-2010-403` |

**`focusgts-ucp` could not be confirmed as a development sandbox.** The credential is a member of no sandboxes, and both the admin listing and the direct lookup are refused.

This is the single most consequential result. `resolveSandbox()` will return type `unknown`, and in the default `safe` mode the write guard **fails closed on every mutation by design**. Until `view-sandboxes` is granted, mutation validation cannot proceed even if every other permission were fixed.

A correction was made to the harness while establishing this: it previously reported "the write guard will be able to resolve a type" on the strength of HTTP 200 alone. A 200 with an empty array is exactly the failing case, so that message was false confidence. It now checks that the target sandbox is actually present in the list.

---

## 4. One implementation error found — ours

| Endpoint | Status | Classification |
|---|:--:|---|
| `/data/foundation/edge/datastreams?limit=1` | **404, HTML body** | **Routing / implementation error** |

Investigated in full: [`datastream-endpoint-investigation-2026-08-12.md`](./datastream-endpoint-investigation-2026-08-12.md).

**The root cause was not the tools.** That path existed only in the probe script. All five datastream tools use `/data/core/edge/datastreams`. The probe was validating a path no tool uses, so its failure said nothing about the tools — and a pass would have been equally meaningless.

Corrected by making the path a single shared constant that both sides reference, with a contract test that fails if they diverge. The test was confirmed to fail against the pre-fix code.

Adobe's public documentation describes **no REST API for datastream configuration**. The tools' path is therefore undocumented and still unverified; it was deliberately not changed, since substituting another unverified guess would not be a fix. All five datastream tools are marked unverified.

For completeness, `/data/core/privacy/jobs` returned a **JSON 404** — route exists, not provisioned for this org. Consistent with Privacy Service being unavailable here, which Dave already observed in the UI.

---

## 5. Live-confirmed capability

| Capability | Status |
|---|---|
| IMS OAuth Server-to-Server token acquisition | **Confirmed working** |
| Org and sandbox header construction | **Confirmed** — requests reached AEP and returned structured AEP errors, not routing failures |
| Sandbox Management endpoint reachability | **Confirmed** (200) |
| Every AEP data surface | **Blocked** |
| All 12 Batch Ingestion and Data Lifecycle tools | **Still unvalidated** |

Five of the six endpoints returned a well-formed AEP error rather than an HTML 404, which does establish that our paths, headers, and auth flow are correct for those surfaces. That is a genuine, if modest, result: when the permissions land, those calls should work without code changes.

---

## 6. Exact Adobe Admin Console changes required

For **Exchange Partner Sandbox Charlie** → product profile **`AEP-Default-All-Users`**, or a new profile attached to the *Focus GTS AEP MCP PALM Dev* credential:

| # | Permission | Unblocks | Priority |
|---|---|---|---|
| 1 | **Sandbox Administration → View Sandboxes** (`view-sandboxes`) | Sandbox type resolution. **Without this, every mutation fails closed regardless of other grants** | **Blocking** |
| 2 | Add the profile to the **`focusgts-ucp` sandbox** | Sandbox membership — the credential is currently in none | **Blocking** |
| 3 | **Data Modeling → View Schemas** | Endpoint 1 | High |
| 4 | **Data Management → View Datasets** | Endpoints 2 and 3 | High |
| 5 | **Segments → View Segments** | Endpoint 6 | Medium |
| 6 | **Data Lifecycle / Data Hygiene** permission on the profile | Endpoints 4 and 5 | Medium |

Item 2 is the likeliest root cause of most of the above: a credential that belongs to no sandbox will be refused on sandbox-scoped surfaces regardless of which functional permissions its profile carries. **Grant items 1 and 2 first, then re-run the harness before requesting anything further** — several of items 3–6 may resolve on their own.

Out of scope for this repository: CJA and Adobe Analytics API project creation is disabled for Dave in Developer Console. An Adobe permission matter, unrelated to the MCP server.

---

## 7. Safety fix — `AEP_SANDBOX_NAME` no longer defaults to prod

`loadCredentials()` previously did:

```ts
sandboxName: process.env.AEP_SANDBOX_NAME ?? "prod",
```

A `.env` missing one line silently pointed every request — reads included — at production, with no warning.

Now:

- `AEP_SANDBOX_NAME` is in `REQUIRED_VARS`; missing or blank fails closed with `MissingCredentialsError`
- Whitespace-only counts as blank — `AEP_SANDBOX_NAME="   "` would otherwise have passed a truthiness check and been sent as a header
- All four required values are trimmed
- The error explains the removed default, so the fix is obvious rather than mysterious
- **An explicit `prod` remains usable for reads.** That is a visible, deliberate choice; mutations there stay blocked by the write guard's sandbox-name refusal

**A pre-existing test asserted the defect** — `"defaults sandboxName to prod when not set"` — locking the dangerous behaviour in as intended. Replaced with one asserting the correct behaviour, and a note explaining why.

Coverage added in `tests/unit/auth/sandbox-name-required.test.ts`: absent, empty, single-space, whitespace-only, explicit `prod`, explicit development, whitespace trimming, error-message content, and the same fail-closed behaviour for the other three required variables.

---

## 8. Tests and typecheck

| Check | Result |
|---|---|
| `tsc --noEmit` | **Clean** |
| Test suite | **199 passed**, 15 files (was 176 / 13) |

---

## 9. Files changed

| File | Change |
|---|---|
| `src/auth/credentials.ts` | `AEP_SANDBOX_NAME` required; blank-safe; all values trimmed |
| `src/util/errors.ts` | `MissingCredentialsError` explains the removed prod default |
| `tests/unit/auth/sandbox-name-required.test.ts` | **New** — 14 cases |
| `tests/unit/auth/credentials.test.ts` | Replaced the test that asserted the defect |
| `scripts/validate-readonly.mjs` | Presence-only preflight; four-way classification; sandbox-presence check replacing the status-only check |
| `.env.example` | Documents that all four values are required and why there is no default |
| `src/tools/datastreams/paths.ts` | **New** — single source of truth for the datastream path, with documentation status |
| `src/tools/datastreams/*.ts` (5) | Refactored to the shared constant |
| `tests/unit/tools/datastreams/path-contract.test.ts` | **New** — 9 cross-boundary contract tests |
| `docs/datastream-endpoint-investigation-2026-08-12.md` | **New** — documentation findings and sources |
| `docs/live-validation-palm-2026-08-12.md` | This report |

---

## 10. Readiness for a staged mutation-validation session

**No.** Two blocking conditions, both on Adobe's side:

1. The credential is a member of **zero sandboxes**
2. `view-sandboxes` is denied, so `focusgts-ucp` cannot be confirmed as type `development`

While (2) holds, `safe` mode refuses every mutation — correctly, by design. Forcing past it would mean `AEP_MODE=production`, which is precisely the wrong response to "we cannot verify which environment this is."

The **code** is ready: four independent gates, per-tool confirmation phrases, 190 passing tests. The **environment** is not.

Re-run `node scripts/validate-readonly.mjs --env .env` after Admin Console items 1 and 2. If Sandbox Management then lists `focusgts-ucp` as type `development` and the six endpoints return 200, the staged mutation plan in the previous revision of this document becomes executable — subject to separate, explicit approval per operation class.
