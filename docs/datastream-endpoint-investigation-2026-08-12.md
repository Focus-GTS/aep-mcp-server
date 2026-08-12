# Datastream Endpoint Investigation

**Date:** 2026-08-12
**Trigger:** HTML 404 from the datastream surface during read-only PALM validation
**Method:** Official Adobe documentation only. No live API requests were made.
**Adobe case:** `SALES0855734` — submitted 2026-08-12
**Linked from:** [`live-validation-palm-2026-08-12.md`](./live-validation-palm-2026-08-12.md)

---

## Conclusion, stated first

**Adobe's current public documentation does not describe a REST API for datastream configuration.** The answer to "what is the correct documented endpoint" is that there does not appear to be one.

The path our tools use — `/data/core/edge/datastreams` — is therefore **not documentation-supported**, and has **not been changed**. Replacing an unverified value with a different unverified value would be a guess dressed as a fix, and the instruction was explicit: do not guess where documentation is inconclusive.

---

## The root cause was not what the 404 suggested

The HTML 404 came from `/data/foundation/edge/datastreams`.

**No tool has ever used that path.** All five datastream tools use `/data/core/edge/datastreams`. The wrong path existed only in `scripts/validate-readonly.mjs`.

So the probe validated a path no tool uses. Its failure told us nothing about the tools, and — worse — a *passing* result would have been equally meaningless. The real defect was a silent disagreement between the validator and the code it was meant to validate.

This also means the datastream tools remain **completely unvalidated**. The one probe that ran tested something else.

---

## Sources consulted

| Source | What it says | Bearing |
|---|---|---|
| [Create and configure datastreams](https://experienceleague.adobe.com/en/docs/experience-platform/datastreams/configure) | UI workflow only — Datastreams workspace, forms, dropdowns. No host, path, or curl example | **This is the page our tools cite.** It documents no API |
| [Datastreams overview](https://experienceleague.adobe.com/en/docs/experience-platform/datastreams/overview) | Defines a datastream as a server-side Edge Network configuration; notes they are also called "edge configurations" | Terminology only |
| [Data Collection API endpoints](https://developer.adobe.com/data-collection-apis/docs/endpoints/) | Two families: Edge Network API (`interact`, `collect`) and Media Edge API | These **send events to** a datastream; they do not manage datastreams |
| [Interact endpoint](https://developer.adobe.com/data-collection-apis/docs/endpoints/interact/) | `server.adobedc.net` (authenticated), `edge.adobedc.net` (unauthenticated) | Different hosts entirely; ingestion, not configuration |
| [Reactor API overview](https://experienceleague.adobe.com/en/docs/experience-platform/tags/api/overview) | `reactor.adobe.io`, manages tags resources | No `edge_configurations` endpoint in current documentation |

### Ambiguity that remains unresolved

1. **No documented configuration API.** Datastreams appear to be UI-managed in current documentation. Whether an undocumented internal endpoint exists — and whether `/data/core/edge/datastreams` is it — cannot be settled from public sources.
2. **"Edge configurations" is a naming echo, not a lead.** The overview page calls datastreams "edge configurations", which historically suggested the Reactor API. Current Reactor documentation lists no such endpoint.
3. **Required permissions are undocumented**, because the API itself is. Data Collection provisioning is the likely gate, but that is inference.

None of this is resolvable without either Adobe confirmation or a live probe against a working credential.

---

## Changes made

### `src/tools/datastreams/paths.ts` — new

Single exported constant plus a helper. All five tools import it, so probe and tools cannot drift again. The file carries the full documentation status inline, including what to do when access is restored:

- JSON 2xx/4xx from this path → route exists, documentation gap only
- HTML 404 → path is wrong; **escalate to Adobe rather than guessing again**

### Five tools refactored

`create`, `list`, `get`, `update`, `delete` now import the shared constant. Verified no hardcoded datastream path remains anywhere outside `paths.ts`.

### `scripts/validate-readonly.mjs`

- Datastream surface corrected to the tools' path, with a comment pointing at the contract test
- Five classifications now, up from four

---

## Tests added — `tests/unit/tools/datastreams/path-contract.test.ts`

9 cases. The important property: **the agreement test fails against the pre-fix code**, verified by running it before applying the fix. It reported exactly `expected '/data/foundation/edge/datastreams' to contain '/data/core/edge/datastreams'`.

| Test | Catches |
|---|---|
| No tool hardcodes the datastream path | Reintroducing a literal that can drift |
| Probe uses the same path as the tools | **The actual 2026-08-12 defect** |
| Probe references no `/data/` service prefix absent from source | Any probe/tool divergence, not just datastreams |
| Every `/data/` path uses a known area segment (`foundation`/`core`) | `/data/edge/...` and misspellings — the HTML-404 class |
| No doubled or trailing slashes | Malformed URL construction |
| No unresolved `{placeholder}` | A template literal that lost its interpolation |
| Single-resource path built from the base | Divergent id-path construction |
| `paths.ts` still records UNVERIFIED status | Someone quietly deleting the caveat |

**Why no mock-response test was written for the path itself.** A mocked test asserts the code calls what the test says it should call — both sides written from the same wrong assumption. It cannot detect that the assumption is wrong. Only a cross-boundary agreement check finds a probe and a tool disagreeing, which is why these are contract tests rather than unit tests with fixtures.

---

## Validator classifications

| Class | Trigger | Owner |
|---|---|---|
| **Working access** | 2xx with content | — |
| **Valid empty response** | 2xx, well-formed, empty collection | Nobody — but confirm empty is expected |
| **Missing sandbox membership** | 200 from Sandbox Management that omits the target sandbox | Adobe admin / support |
| **Missing product-profile permission** | 403 | Adobe admin (Admin Console) |
| **Missing entitlement** | JSON 404, or 401 after org/sandbox/profile are ruled out | Account team |
| **Unsupported or undocumented endpoint** | HTML 404 where Adobe publishes no API | Adobe — ask for the supported API |
| **Implementation error** | HTML 404 on a *documented* surface, 405, 400 | **Us** |
| **Server-side** | 5xx | Adobe support, with `x-request-id` |

The last two split what used to be one class. An HTML 404 always means the request never reached an AEP service — but *why* depends on whether the endpoint is meant to exist. Attributing a route Adobe may not offer to our code sends the wrong person to fix it. The classifier takes a `documented` flag per surface; the datastream surface is `documented: false`.

Classification now lives in `scripts/classify-response.mjs` with **28 unit tests**, rather than inline and untested. Two of those tests encode conclusions the untested version got wrong: an empty `sandboxes: []` reported as success, and an HTML 404 blamed on us unconditionally.

**Valid-empty and missing-membership were added because their absence produced a wrong conclusion.** On 2026-08-12 the harness reported Sandbox Management as plain success on a 200 — but the payload was `sandboxes: []`, and that empty array was the most consequential result of the run. It meant the credential belonged to no sandbox and every mutation would fail closed. A classification scheme that cannot distinguish "reachable and empty" from "reachable with data" will keep producing that error.

---

## Status of the five datastream tools

| Tool | Path | Documented | Live-verified |
|---|---|:--:|:--:|
| `aep_create_datastream` | `POST /data/core/edge/datastreams` | ❌ | ❌ |
| `aep_list_datastreams` | `GET /data/core/edge/datastreams` | ❌ | ❌ |
| `aep_get_datastream` | `GET .../{id}` | ❌ | ❌ |
| `aep_update_datastream` | `PUT .../{id}` | ❌ | ❌ |
| `aep_delete_datastream` | `DELETE .../{id}` | ❌ | ❌ |

All five tool **descriptions** now carry the caveat verbatim — "ENDPOINT UNDOCUMENTED — LIVE VALIDATION PENDING" plus the case reference — so it appears in `tools/list` where an agent or operator sees it before calling, not only in a document nobody opens. A test asserts it stays there.

**Recommendation:** treat all five as unverified in any customer-facing material until a live probe confirms the route. If the HTML 404 recurs on the corrected path once permissions land, ask Adobe for the supported datastream configuration API rather than searching for another candidate path — at that point the absence of documentation is itself the finding worth escalating.
