# AEP MCP Server — Comprehensive Audit Report
## Compiled 2026-05-28 from 6-agent specialist swarm

---

## Overall Verdict

**Architecturally Adobe-grade. Operationally not yet ready for Adobe.**

The code quality, MCP compliance, and security foundation are excellent — multiple auditors said "better than Adobe's own first-party MCPs." But the runtime fragility, API endpoint errors, and presentation gaps mean a real demo to Adobe today would expose embarrassing failures.

**Time to "wow-factor ready" estimate**: 2-3 focused days of work.

---

## TIER 1 — MUST FIX BEFORE ADOBE SEES THIS (Critical Blockers)

### API Correctness Issues (Will Fail Live Demo)

| # | Issue | File | Impact |
|---|-------|------|--------|
| 1 | **`estimate-segment-size` endpoint doesn't exist** — needs 2-call flow (POST `/preview` → GET `/estimate/{previewId}`) | `segments/estimate-segment-size.ts:73` | Tool 100% broken |
| 2 | **`list-sources`/`list-destinations` filter wrong** — `providerId==SOURCES` returns empty (providerId is GUID, not literal) | `sources/list-sources.ts:48`, `destinations/list-destinations.ts:50` | Returns zero results in demo |
| 3 | **`activate-segment` will 400** — missing `flowSpec.id`, empty `sourceConnectionIds`, wrong transform name | `destinations/activate-segment.ts:83` | Tool 100% broken |
| 4 | **`get-identity-graph` wrong param name** — `nsid` should be `nsId` (camelCase) | `identities/get-identity-graph.ts:78` | Silently ignored, returns wrong data |
| 5 | **`delete-profile` missing required `schema.name`** + trailing slash + uses deprecated endpoint | `profiles/delete-profile.ts:62` | 400 errors |
| 6 | **`list-queries` `start` is ISO timestamp**, not offset integer | `query/list-queries.ts:67` | Pagination broken |
| 7 | **`list-datasets` `name`/`state` not Catalog filters** — must use `property=` | `datasets/list-datasets.ts:54-56` | Filters silently ignored |
| 8 | **`get-query-status` result fetch wrong** — Adobe uses Postgres interface for results, not REST | `query/get-query-status.ts:93` | `resultsSample` always fails |
| 9 | **Flow Service property filters need repeated keys**, not comma-joined | `sources/list-dataflows.ts:60` + `aep-client.ts:97` | Filters broken |

### Security HIGH-severity Issues

| # | Issue | File | Fix |
|---|-------|------|-----|
| 10 | **SSRF risk** — absolute URLs pass through with Bearer token attached | `auth/aep-client.ts:93` | Hostname allowlist (`.adobe.io`/`.adobe.com`) |
| 11 | **Error body passthrough leaks** trace IDs, sandbox IDs, request IDs | `util/errors.ts:27-33` | Whitelist safe fields only |
| 12 | **IMS error echoes** `client_id` into thrown error message | `auth/token-cache.ts:60-62` | Strip body before throw + pino redact |
| 13 | **`delete-profile` has no confirmation gate** — irreversible GDPR purge | `profiles/delete-profile.ts` | Require explicit `confirm` literal arg |

### Production BLOCKERS (Will Fail in Customer Hands Within Hours)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 14 | **No request timeout** — hung Adobe endpoint = frozen forever | `auth/aep-client.ts:41` | `AbortSignal.timeout(30_000)` |
| 15 | **No retry on 429/5xx** — first rate-limit burst surfaces errors | `auth/aep-client.ts:47-57` | Exponential backoff with `Retry-After` |
| 16 | **No 401-driven token re-auth** — token rotation = permanent failure | `auth/aep-client.ts:47-57` | Invalidate + retry once on 401 |
| 17 | **No SIGTERM/SIGINT/uncaughtException handlers** | `server.ts:37-40` | Install handlers, graceful shutdown |
| 18 | **dist/server.js not executable after build** — `npx aep-mcp` fails | `package.json:46-49` | `postbuild: chmod +x dist/server.js` |

### Presentation BLOCKERS

| # | Issue | File | Fix |
|---|-------|------|-----|
| 19 | **NO README.md** — Adobe engineer cloning sees no value prop | repo root | Write comprehensive README with comparison table |
| 20 | **CLAUDE.md claims `aep_ingest_data` tool that doesn't exist** | `CLAUDE.md:74` | Reconcile docs with actual 22 tools |
| 21 | **No LICENSE file + `"license": "UNLICENSED"`** | `package.json:31` | Add LICENSE + pick proprietary or open |
| 22 | **`"private": true`** blocks Exchange listing + npm publish | `package.json:6` | Remove or document why |

---

## TIER 2 — HIGH POLISH (Before Marketing Push)

### MCP Spec Modernization

- Migrate `server.tool()` → `server.registerTool()` (SDK 1.17+) for proper `annotations.destructiveHint`/`readOnlyHint`/`idempotentHint`
- Add `instructions` field to McpServer constructor (system-level agent guidance)
- Consider `structuredContent` for machine-readable errors

### Code Quality Polish

- Run `prettier --write src/` — handler indentation off by 2 spaces in all 22 tool files
- Extract `listResults()` + `inferTotal()` helpers — duplicated 6× across list tools
- Add `AuthError` class so token failures get proper `AEP_AUTH_*` codes
- Fix product-tagging consistency (Schemas tagged AEP, Identities mixed AEP/RTCDP — pick one)
- Type request bodies with proper interfaces (currently mixed inline literals and typed)

### Observability

- Add per-tool-call `requestId` (crypto.randomUUID) for log correlation
- Capture latency (`durationMs`) on every tool invocation
- Add pino `redact` for `client_secret`, `Authorization`, `entityId`, `email`, etc.
- Add startup self-check (call `tokenCache.getToken()` in `main()` to fail-fast)
- Add `withTelemetry()` middleware wrapping all tool registrations

### Reliability

- Token cache: clamp refresh buffer to `min(expires_in/2, 5min)` to avoid infinite refresh loops
- Token cache: circuit-breaker after IMS failures (currently hammers on outage)
- Zod-validate credentials at boot (`AEP_ORG_ID` matches `*@AdobeOrg`)
- Pin exact dependency versions (caret allows drift)
- Tighten `engines.node` to `>=20.18.0` + add `.nvmrc`

---

## TIER 3 — NICE TO HAVE

- CI config (`.github/workflows/ci.yml`) — typecheck + test + build on PR
- `CHANGELOG.md`
- `.eslintrc` + `.prettierrc` configs
- `npm run test:live` script for one-command demo
- `npm run tools` script that prints all 22 tools with metadata headers
- Asciinema / screenshot of integration test green output
- Architecture diagram in README
- Comparison table vs Adobe's first-party MCPs in README
- Adobe Exchange listing copy ready to ship
- Per-tool handler unit tests (currently only auth/util covered)
- Coverage threshold enforcement in `vitest.config.ts`

---

## What's Genuinely Excellent (Don't Touch)

All 6 auditors agreed:

- **Token cache concurrent-refresh dedup** — textbook correct
- **`pino.destination(2)` to stderr** — single most common MCP mistake, done right
- **Zod `.describe()` annotations** — unusually disciplined
- **Folder structure mirrors AEP's product taxonomy** — Adobe engineers will recognize this immediately
- **`describe()` metadata helper** — most Adobe-native touch in the repo
- **`_hint` field in query tools** — above-spec UX Adobe's own MCPs lack
- **All path segments correctly `encodeURIComponent`'d** — no path traversal
- **DESTRUCTIVE: prefix on delete-profile** — best-in-class safety signaling
- **File sizes tight** — largest 170 lines, all under 500
- **Zero `any` types** — `unknown` used appropriately at boundaries
- **`_hint` field in run-query/get-query-status** — guides agent to next call
- **CLAUDE.md strategic framing** — "own this MCP layer and you own everything downstream"

---

## Recommended Execution Plan

### Day 1: Critical Blockers (8 hours)
- Morning: API correctness fixes (#1-9) + re-run live test
- Afternoon: Security HIGH items (#10-13) + Production blockers (#14-18)

### Day 2: Presentation + Polish (8 hours)
- Morning: README + LICENSE + CLAUDE.md fix + npm scripts
- Afternoon: SDK modernization (`registerTool`) + observability (correlation IDs, redact, latency)

### Day 3: Demo Prep (4 hours)
- Re-run integration test (should pass 18+ of 20 now)
- Capture asciinema of green test run
- Adobe Exchange listing copy
- Comparison table polish

---

## The Honest Bottom Line

The architecture is genuinely impressive. The auditors weren't being generous — they consistently said "this could pass for first-party Adobe code." But the API correctness issues are real: 9 of 22 tools have endpoint/payload bugs that will fail when an Adobe engineer hits them in a demo. The production gaps (no timeout, no retry, no 401 recovery) would surface within hours of any real customer using it.

**Good news**: every issue identified is concrete and fixable. None are architectural rewrites. The path from "polished demo" to "Adobe-presentation-ready" is straightforward execution, not redesign.

The pieces are all in place. The polish needs to happen before the meeting.
