# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **An empty privacy job list was reported as an error.** Adobe Privacy Service
  answers a query that matched nothing with HTTP 404 and
  `"detail":"Not able to find job data."`. `aep_list_privacy_jobs` surfaced that
  as `AEP_404`, so "you have no privacy jobs" — the normal state of most
  tenants — looked like a broken tool and pushed agents into retrying. It now
  returns an empty list. Narrowly scoped: a 404 reading as *not authorized* or
  *not provisioned* is still an error, because that one needs a human.

- **Adobe's nested error detail was being thrown away entirely.** The error-body
  sanitizer whitelisted **top-level keys only**, and Adobe nests the useful part
  of many errors under `errors`:

  ```json
  {"errors":{"errorCode":404,"title":"Resource not found","detail":"Not able to find job data."}}
  ```

  `errors` was not on the whitelist, so the whole envelope was dropped and
  clients received `{}`. Every error of that shape arrived with no explanation,
  which is how a 404 meaning "nothing matched" became indistinguishable from a
  404 meaning "no such route". The sanitizer now recurses **one level** into
  `errors`, applying the same whitelist, so the detail survives while unlisted
  fields inside it are still dropped. Only `errors`, only one level — the
  whitelist stays authoritative.

### Added

- **`scripts/validate-tools-readonly.mjs`** — live validation that invokes the
  **registered tool handlers** rather than raw HTTP paths, so it reports what an
  agent would actually get. It refuses to call any tool not annotated
  `readOnlyHint: true` and force-clears `AEP_ALLOW_MUTATIONS` before building
  the client, so it cannot mutate. **18 of 18 runnable read-only tools pass; the
  other 9 need an id this sandbox cannot supply and are reported as
  `no-fixture` rather than guessed at.**

  It exists because a path-level probe and the tools it was meant to validate
  had silently disagreed once before, and neither found the other's bug. Both
  fixes above came out of its first run.


## [0.9.0] - 2026-08-17

### ⚠️ Breaking

- **The five datastream tools are removed.** `aep_list_datastreams`,
  `aep_get_datastream`, `aep_create_datastream`, `aep_update_datastream` and
  `aep_delete_datastream` are gone. The tool surface is **48**, down from 53.

  They called `/data/core/edge/datastreams` on `platform.adobe.io`. **That route
  does not exist.** Probed live on 2026-08-17, every plausible variant returned
  an HTML 404 — a gateway-level "no such path", not a JSON authorization error —
  so no credential, entitlement, or sandbox could ever have made them work. They
  were not blocked; they were pointed at nothing, and had been since v0.3.0.

  Datastream configuration lives on **Reactor** (`reactor.adobe.io`) as
  `edge_configurations`, behind the **Experience Platform Launch API** — which
  the Developer Console shows as present but **disabled** for this
  organization, and which `reactor.adobe.io/companies` confirms with
  `api-key-invalid`.

  Removal rather than deprecation, because the entitlement alone would not have
  helped: Reactor is a different host, a different auth scope, a JSON:API
  envelope, and company-scoped rather than sandbox-scoped. There was no future
  in which the existing code started working. A tool that always fails is worse
  than an absent one — it appears in `tools/list`, an agent picks it, and the
  failure reads as a confusing gateway error instead of "not available here".

  **No user integration can break, because none can ever have worked.**

  Full evidence, including the six-path probe table and the HTML-404 vs
  JSON-404 distinction that settled it, is in
  [ADR-0005](./docs/adr/0005-remove-datastream-tools.md). ADR-0003, which added
  them, is marked superseded.

### Changed

- Tool count 53 → **48**; categories 12 → **11**. `destructiveHint` is now 7
  (was 8) and `readOnlyHint` 27 (was 29). README, hero image, validation
  matrix, `package.json`, `server.json` and `CLAUDE.md` all updated — the last
  of which had been stale since it still claimed 34 tools across 10 categories.

- **`scripts/validate-readonly.mjs` keeps probing the dead datastream path on
  purpose**, now flagged as expected-404. It is a regression check: if that
  path ever answers in JSON, Adobe has shipped a Platform-side datastream API
  and this decision is worth revisiting.

- The `Datastream` type is deleted rather than left unused. It described a
  response shape from an endpoint that never responded; the replacement must be
  written from real Reactor responses, not restored from git history.

### Added

- A test asserting **no registered tool name contains `datastream`** and that
  the validation matrix documents no Datastreams category — so they cannot
  return by accident against the dead path.


## [0.8.1] - 2026-08-17

Metadata-only release. No source, dependency, or behaviour changes — cut so the
corrected tool count reaches the npm and MCP Registry listings, which read the
description out of the published tarball and so were still advertising 46.

### Fixed

- **The package descriptions said 46 tools; there are 53.** `package.json` and
  `server.json` both carried the stale count, as did the GitHub About text
  (corrected separately through the API, since that one is not published from
  the repo).

  These are the three places the tool count is duplicated outside the README,
  and none is covered by the test that keeps the README and the registry in
  agreement — which is precisely why they drifted while the README stayed
  correct. The count last changed at 0.8.0, when the quota tool took the
  surface from 52 to 53; the descriptions had been wrong since 0.7.0.

  "46 tools" references under the 0.6.0 and 0.6.2 entries below are left as
  written. There were 46 tools then.

### Changed

- The README is rebuilt in the visual style used by
  [eds-mcp-server](https://github.com/Focus-GTS/eds-mcp-server) — hero image,
  mermaid diagrams, column tool tables, collapsible per-client setup. Restyling
  it meant re-deriving every figure from the built registry, which turned up
  a batch of drift: the comparison table said 46 tools, batch ingestion said 5
  (it is 7), `destructiveHint` said 4 and named the wrong set (it is 8),
  `readOnlyHint` said 27 (29), and the test count said 57 (402). The
  confirmation-gate table listed four gates and was missing five.

  Two were worse than stale counts. The quickstart told readers to set
  `AEP_SANDBOX_NAME=prod`, in both the `.env` example and the Claude Desktop
  config — the default 0.7.0 removed precisely because it silently pointed
  every request, reads included, at production. And `AEP_ALLOW_MUTATIONS` was
  undocumented despite being the switch that gates every write.


## [0.8.0] - 2026-08-16

### ⚠️ Breaking

- **`aep_create_record_delete` no longer accepts `ALL`.** The tool's schema
  previously told the model: "Pass the literal `'ALL'` to delete the identities
  from every dataset in the sandbox." Anyone whose prompt led a model to take
  that suggestion in a shared sandbox would have issued a non-cancellable
  deletion across datasets belonging to other people. `ALL` — along with `*`,
  `all`, `any`, `prod`, `production`, comma-separated lists, and blank or
  malformed IDs — is now refused before any network call. The tool requires the
  exact ID of one dataset.

- **The record-delete confirmation phrase changed** from a generic
  `I understand this is irreversible` to
  `DELETE RECORDS <datasetId> <identityDigest>`, where the digest is a
  SHA-256 over the canonical, order-independent namespace/identity set. The old
  phrase named neither the dataset nor the identities, so a confirmation
  granted for one deletion authorised any other. Existing callers passing the
  old phrase will now receive `CONFIRMATION_REQUIRED`.

### Added

- **`aep_get_data_lifecycle_quota`** — read-only `GET /data/core/hygiene/quota`,
  with an optional `quotaType` filter. Reports dataset-expiration and
  consumer-delete-identity quota consumption. Live-validated.

- **Record-delete preflight.** Before submitting, the tool resolves the dataset
  and its schema and refuses when the dataset has no primary identity or
  `identityMap` (`NO_PRIMARY_IDENTITY`), or when it already has an active
  expiration scheduled (`DATASET_HAS_ACTIVE_EXPIRATION`). Adobe requires the
  former; the latter is a conflict worth stopping on rather than racing.

- **`dryRun` on `aep_create_record_delete`, defaulting to true**, making zero
  network calls and returning the request that would be sent.

### Security

- **Tenant identifiers removed from the tracked tree.** The repository is
  public and carried two real IMS org IDs, a development sandbox name, an
  Adobe Developer Console project name, and Adobe support case numbers, plus
  twelve run ledgers and four pinned cleanup scripts naming live dataset,
  batch and TTL IDs. None of these are credentials — no credential was ever
  committed, across all 56 commits — but they are tenant metadata and did not
  belong in public. Documentation now uses `<IMS_ORG_ID>`,
  `<DEVELOPMENT_SANDBOX>`, `<DATASET_ID>`, `<BATCH_ID>` and `<TTL_ID>`
  placeholders; ledgers and cleanup scripts are untracked and gitignored while
  still being written locally.

- **The wrong-org guard is now supplied by the caller and fails closed.**
  `scripts/validate-readonly.mjs` and `scripts/phase-runner.mjs` required
  `AEP_EXPECTED_ORG_ID` / `AEP_EXPECTED_SANDBOX_NAME`; a missing expectation is
  fatal, because "nobody said which tenant" must never read as "any tenant".
  A mismatch is now fatal too — it previously printed `UNEXPECTED (...)` and
  then issued the requests anyway, and a warning nobody reads is not a guard.
  Neither the expected nor the actual value is ever printed: the harness shows
  a 12-character SHA-256 fingerprint of each, which is enough to see whether
  two values agree without putting a tenant ID into a CI log.

- **Identity values are never echoed, logged, or returned** by
  `aep_create_record_delete` — not in dry-run output, not in error messages,
  not in logs. Output carries only an identity count, the namespace names, and
  the 12-character digest. A record-delete request is by nature a list of real
  people's email addresses and device IDs; a tool that reflects them back
  copies them into every transcript and log sink that touches it.

### Changed

- Tool count is now 53. Enumerated from the registry, not counted by hand: a
  new test registers every tool and asserts that `docs/VALIDATION-MATRIX.md`
  names exactly that set, so the document cannot drift from the code again.

- **Corrected: there are five datastream tools, not four**, and there is no
  cancel-batch tool. Both errors came from counting rows in a table rather than
  tools in the registry — the matrix had collapsed `aep_update_datastream` and
  `aep_delete_datastream` onto one row, and had listed a cancel-batch tool that
  has never existed. Batch Ingestion is 7 tools.

- **`docs/VALIDATION-MATRIX.md` rewritten.** It had opened with "No tool in this
  table has been exercised against a live Adobe tenant" since 2026-08-11 — true
  when written, false from 2026-08-14. It also documented
  `aep_create_dataset_expiration` as `PUT /ttl/{id}` with a `dryRun` mode Adobe
  does not offer. It now records, per tool, what was actually executed live.

### Notes

- **`aep_create_record_delete` has never been executed against a live tenant,
  and deliberately so.** Work-order creation is on the permanent NEVER list for
  the shared development sandbox: the operation is asynchronous, non-cancellable, and
  may take up to 30 days. Its contract is verified against Adobe's
  documentation and covered by 23 unit tests. Both consumer-delete quota
  counters reading zero independently confirms none has ever been issued.

- `aep_get_work_order_status` remains unvalidated. It needs an existing
  `workorderId`, and no work order exists in this sandbox — creating one purely
  to obtain an ID is not a justification for an irreversible operation.

## [0.7.0] - 2026-08-11

### ⚠️ Breaking

- **Mutations are now off by default.** No write, update, or delete tool can
  execute unless `AEP_ALLOW_MUTATIONS=true` is set. If you were running 0.6.x
  with writes working, they will be refused after upgrading until you add that
  variable.

  This is deliberately separate from `AEP_MODE`. Choosing a write mode says
  "here is how much I want this server to trust the sandbox"; it should not
  also say "yes, this server may change my data". One variable doing both jobs
  meant a single setting could open everything.

- **A sandbox named `prod` or `production` is refused for all mutations,
  unconditionally.** This check runs *before* write-mode resolution, so
  `AEP_MODE=production` no longer lifts it. Override with
  `AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD=true` only if your sandbox is genuinely
  named `prod` and you intend to write to it.

  This is not the server inferring safety from a name, which it still never
  does. The inference is asymmetric: trusting a name to *allow* a write is
  unsafe, because a production sandbox can be called anything. Trusting a name
  to *deny* one is safe — the worst case is a refusal you can override
  deliberately.

### Fixed

- **`aep_create_record_delete` sent the wrong payload and would have failed
  against any live tenant.** It posted a flat `identities: [{namespace, id}]`
  array. Adobe's Data Lifecycle API requires `namespacesIdentities` — an array
  of `{ namespace: { code }, ids: [...] }` grouped by namespace.

  The tool schema still accepts the flat form, which is markedly easier to
  produce correctly, and converts on the way out. Found by auditing against
  Adobe's documentation, not by the test suite, which was green throughout.

- **`AEP_MODE=production` bypassed the sandbox check entirely.**
  `assertWriteAllowed` returned early on production mode before evaluating the
  sandbox, so one environment variable was enough to permit a mutation against
  a sandbox named `prod`. Both new gates now run ahead of mode resolution.

- **Raw Adobe error response bodies were logged at debug level.** Adobe echoes
  request context, and on Profile and Identity surfaces that can include
  identity values — the PII the redact list exists to exclude. Redaction cannot
  reach inside an opaque string, and debug level is not protection because
  operators raise log levels during incidents. Now behind
  `AEP_LOG_RESPONSE_BODIES`, default off.

- A source comment claimed Adobe's single-`PUT` ceiling for batch upload was
  512 MB. The documented figure is 256 MB. The tool's own 100 MB cap was always
  safely below both, so no behaviour was wrong — but a wrong constant in a
  comment becomes a wrong constant in code the first time someone raises a
  limit and trusts it.

### Added

- `scripts/validate-readonly.mjs` — a `GET`-only live validation harness,
  hard-asserted against non-GET methods and safe to run against production. It
  probes schemas, datasets, batches, hygiene work orders, dataset expirations,
  segment definitions, datastreams, privacy requests, and Sandbox Management,
  and reports explicitly when the write guard will be unable to resolve a
  sandbox type — in which case `safe` mode fails closed on every mutation, by
  design. Refuses to start unless `AEP_ORG_ID` ends in `@AdobeOrg`.

- `docs/VALIDATION-MATRIX.md` — per-tool status across documentation-verified,
  mocked, live-read, and live-write for the 12 Batch Ingestion and Data
  Lifecycle tools. **None are live-validated**, and the document says so
  plainly rather than leaving it to be discovered.

- Adobe's documented 100,000-identity ceiling is now enforced on
  `aep_create_record_delete`.

- 55 new tests (148 → 176): 31 covering the mutation gates and every bypass
  route found, 9 on the record-delete wire format, and 17 on log redaction —
  which deliberately assert the *gap* as well as the coverage, since pino's
  `*.` wildcard matches one level and a secret nested deeper passes through.

- `AEP_ALLOW_MUTATIONS`, `AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD`, and
  `AEP_LOG_RESPONSE_BODIES` documented in `.env.example`.

### Changed

- The `.env.example` sample sandbox is no longer `prod` — shipping an example
  naming the one sandbox the server refuses to mutate was needlessly confusing.

## [0.6.3] - 2026-08-09

### Fixed
- **Shell injection in the release workflow.** The GitHub Release step
  interpolated the changelog into a shell command, so backticks in release
  notes were executed by bash as command substitution. This broke the 0.6.2
  release after npm had already published, and meant anything landing a
  CHANGELOG entry could run arbitrary commands in CI. Notes are now written to
  a file and passed with `--notes-file`; no step output is interpolated into a
  shell anywhere in the workflow.

## [0.6.2] - 2026-08-09

### Fixed
- **The server exited instead of starting when Adobe credentials were invalid.**
  A failed IMS token fetch at startup was fatal, so an MCP client could never
  complete a handshake or call `tools/list` without working credentials — the
  process was gone before it spoke any protocol. A user could not inspect the
  tool surface before configuring auth, and registries that verify a server
  with placeholder credentials saw only a crash, which is why this server was
  marked "cannot be installed" and "quality — not tested" on Glama.

  Authentication failure now logs a prominent warning and the server continues.
  Individual calls already report auth problems as structured `AEP_AUTH_*`
  errors, which is a clearer place for them to surface. Nothing is weakened:
  without a token every request fails at the Adobe boundary, and sandbox
  resolution fails closed, so writes stay blocked.

### Added
- End-to-end MCP protocol test (`tests/integration/handshake.test.ts`) that
  runs the **built** server with deliberately invalid credentials and asserts
  `initialize` completes, `tools/list` returns all 46 tools, annotations
  survive the wire, and a tool call fails as a structured error rather than a
  crash. Skips cleanly when `dist/` is absent. Suite: 112 → 117.

### Changed
- Dockerfile: Node 20 → 22; runs as the unprivileged `node` user; and the
  build stage now fails if the compiled output cannot load and register tools,
  so a broken image cannot be published.

## [0.6.1] - 2026-08-08

First release published by the automated pipeline rather than by hand.

### Added
- Automated release pipeline. Pushing a `v*` tag runs gates (tag matches
  `package.json` and `server.json`, version not already on npm, CHANGELOG entry
  present, typecheck, test, build, and a smoke check that the built entrypoint
  actually registers its tools), then publishes to npm, creates the GitHub
  Release from the CHANGELOG, and registers with the Official MCP Registry.
- npm **Trusted Publishing** via OIDC. There is no npm token stored anywhere;
  GitHub mints a short-lived credential per run and npm generates the
  provenance attestation itself.
- `server.json` for the Official MCP Registry, published as
  **`com.focusgts/aep`** — a domain-verified namespace proved by a TXT record
  on `focusgts.com`, so it belongs to the company rather than to an individual
  GitHub account.
- `glama.json` recording listing maintainers.
- `scripts/extract-changelog.mjs` and `scripts/sync-version.mjs`, plus a
  `version` lifecycle hook so `npm version` keeps `server.json` in step
  automatically.
- `docs/PUBLISHING.md` covering the one-time setup, the release procedure, and
  recovery when a release fails before or after the publish step.

### Note for npm users
This is the first npm release since 0.3.1. Everything between — the pagination
and sandbox-scoping fixes, batch ingestion, data lifecycle, the write modes and
production-write guard, and tool annotations — arrives with this version. See
the 0.4.0, 0.5.0, and 0.6.0 entries below.

## [0.6.0] - 2026-08-08

### Added
- **MCP tool annotations on all 46 tools.** Every tool now declares
  `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`.
  These are what an MCP client uses to decide when to interrupt and ask the
  human before a call — without them a client cannot tell `aep_delete_profile`
  from `aep_list_schemas`, and treats both identically.
  - 27 tools are `readOnlyHint: true`.
  - 4 are `destructiveHint: true`: `aep_delete_profile`,
    `aep_delete_datastream`, `aep_create_record_delete`,
    `aep_create_dataset_expiration`. A test asserts that list exactly, so a
    fifth destructive tool has to be added deliberately.
  - Annotations are derived from the metadata that already builds each tool's
    description, so description and annotation cannot drift apart.
- `defineTool()` helper in `src/util/metadata.ts`, generic over the Zod input
  shape and typed against the SDK's own `ToolCallback<S>`, so handlers keep
  full parameter inference.

### Changed
- All 46 tools migrated from the deprecated `server.tool()` to
  `server.registerTool()`. `server.tool()` cannot carry annotations; the SDK
  marks it deprecated. No tool name, input schema, or behaviour changed.

### Note
- The installed SDK is 1.29.0. An earlier review recorded annotations as
  unavailable because `package.json` declares `^1.12.1` — that reads the
  declared range rather than the resolved version. Nothing needed upgrading.

## [0.5.0] - 2026-08-08

### Added
- **Write modes (`AEP_MODE`).** Three supported postures rather than a single
  on/off escape hatch:
  - `read-only` — no mutation in any sandbox. For handing the server to someone
    to explore an environment that must not be touched.
  - `safe` (default) — writes only where Adobe classifies the sandbox
    `development`.
  - `production` — writes anywhere. A first-class posture for teams running
    their own change control, not a jailbreak; logs a warning at startup.

  An unrecognised value falls back to `safe`, so a typo cannot grant production
  writes. `AEP_ALLOW_PRODUCTION_WRITES=true` is deprecated but still honoured
  as an alias for `AEP_MODE=production`; `AEP_MODE` wins if both are set.
  The mode is resolved once at client construction, so a mid-run environment
  change cannot escalate a running server's permissions.

- **Production-write guard.** At startup the server resolves the configured
  sandbox against Adobe's Sandbox Management API and, in `safe` mode, permits
  POST/PUT/PATCH/DELETE only when Adobe classifies it `development`. Reads are
  unaffected in every mode.
  - Decides on Adobe's own `type` field, never the sandbox name — a production
    sandbox may be named anything.
  - **Fails closed**: an unresolvable sandbox type blocks writes, so a
    credential cannot gain write access by lacking sandbox-view permission.
  - Enforced in `AepClient.request()` — a single chokepoint every tool already
    routes through, so no current or future tool can bypass or forget it.
  - Blocked calls never reach Adobe; they return a structured `WRITE_BLOCKED`
    tool error naming the sandbox, its type, and the fix.
  - Verified against the live tenant: Adobe reported `prod` as `production`,
    and create/update/delete were all refused locally.
- 43 tests covering the guard and the three modes, including fail-closed
  behaviour, the "name is not type" property, and typo-falls-back-to-safe.
  Suite: 57 → 100.

### Security
- `.gitignore` matched `.env` and `.env.local` as exact patterns, so sibling
  credential files such as `.env.prod-backup` were **not** ignored and showed
  as committable. Replaced with `.env.*` plus `!.env.example`. Audited: no
  credential file has ever been committed.

## [0.4.0] - 2026-08-07
### Added
- Batch Ingestion (5): aep_create_batch, aep_upload_batch_file,
  aep_complete_batch, aep_get_batch_status, aep_list_batches — the first
  write path for getting data *into* AEP rather than only configuring it
- Data Hygiene / Data Lifecycle (5): aep_create_record_delete,
  aep_get_work_order_status, aep_list_work_orders,
  aep_create_dataset_expiration, aep_list_dataset_expirations
- aep_update_schema — schema edits no longer require delete-and-recreate
- aep_create_destination_connection — unblocks aep_activate_segment, which
  previously required a connection the server had no way to create
- "Ingestion" and "Data Hygiene" added to the ToolCategory enum
- WorkOrder, DatasetExpiration, and batch ingestion types in src/types/aep.ts
- ADR-0004: Reposition against Adobe's first-party MCPs; write operations as
  the durable moat
- CONTRIBUTING.md, SECURITY.md, and GitHub issue templates

### Changed
- Tool count: 34 → 46 across 10 → 12 categories
- `buildPaginatedResponse` signature is now
  `(results, params, hints?)` — `total` moved into an optional `hints` object
  and is reported as `null` when the upstream API never supplied one
- Paginated responses gained a `hasMoreBasis` field
  (`next-link` | `total` | `full-page` | `short-page`) so callers can tell a
  confirmed page boundary from a heuristic one
- Credential format validation at bootstrap now warns instead of throwing.
  The patterns are heuristics about Adobe's ID formats, and a false positive
  must not refuse to start a server whose credentials actually work; genuinely
  bad credentials are still caught by the IMS token self-check moments later
- aep_delete_profile is marked **deprecated** in favour of
  aep_create_record_delete. It still works, and keeps its confirmation gate,
  but it wraps a UPS endpoint Adobe announced would be deprecated by the end
  of October 2025

### Fixed
- **`hasMore` was mathematically always false on every paginated list tool.**
  Several AEP endpoints return a page-level `count` that was being passed as
  the all-pages `total`, so `offset + count < total` never held. Agents
  paginating these tools silently stopped after the first page
- aep_run_query ignored the configured sandbox, and its description advertised
  an `includeResults` behaviour the endpoint does not have
- aep_create_schema could emit a schema with no properties, producing an XDM
  schema that validated but described nothing
- aep_get_dataset returned empty error `details` on a 404, because it passed a
  bespoke `datasetId` key that `sanitizeErrorBody`'s field allowlist stripped

### Security
- Destructive Data Hygiene tools gate before the network call:
  aep_create_record_delete always requires
  `confirm: "I understand this is irreversible"`, and
  aep_create_dataset_expiration requires it unless `dryRun: true`, where
  nothing is scheduled or deleted

### Known limitations
- Data Hygiene and Batch Ingestion endpoint shapes come from Adobe's published
  API documentation and have **not** been exercised against a live sandbox.
  Each affected tool says so in its description. Validate against your own
  sandbox before relying on them in production

## [0.3.1] - 2026-06-23
### Changed
- Relicensed from proprietary ("All rights reserved") to **Apache License 2.0**
- package.json `license` field: `SEE LICENSE IN LICENSE` → `Apache-2.0`
- Contributions opened to public PRs (previously by prior arrangement only)
- package.json description synced to the real inventory at the time
  (34 tools across 10 categories)

### Added
- NOTICE file: Adobe and Anthropic trademark disclaimers, statement of
  independence from Adobe, dependency attributions, and a no-warranty plus
  API-stability caveat
- NOTICE added to the published package `files` list

No functional code change in this release.

## [0.3.0] - 2026-06-03
### Added
- Datastreams (5): aep_list_datastreams, aep_get_datastream,
  aep_create_datastream, aep_update_datastream, aep_delete_datastream
- "Datastreams" added to ToolCategory enum in metadata helper
- Datastream type definition in src/types/aep.ts (with opaque config object)
- ADR-0003: Add Adobe Data Collection (Datastreams) tools as v0.3.0
- Live integration test section for Datastreams

### Changed
- Tool count: 29 → 34 across 9 → 10 categories

## [0.2.0] - 2026-06-02
### Added
- Privacy Service (6): aep_create_privacy_job, aep_get_privacy_job,
  aep_list_privacy_jobs, aep_cancel_privacy_job, aep_get_privacy_job_results,
  aep_list_privacy_namespaces
- Support for 47 privacy regulations (GDPR, CCPA, HIPAA, LGPD, etc.) as
  typed enum on Privacy Service tool inputs
- "Adobe Privacy Service" added to AdobeProduct enum in metadata helper
- "Privacy" added to ToolCategory enum in metadata helper
- ADR-0001: Adopt Architecture Decision Records (MADR format)
- ADR-0002: Add Adobe Privacy Service tools as v0.2.0
- Live integration test section for Privacy Service

### Changed
- Tool count: 23 → 29 across 8 → 9 categories

## [0.1.0] - 2026-05-28
### Added
- Initial release with 23 tools across 8 AEP categories
- OAuth 2.0 Server-to-Server authentication with concurrent-refresh-deduped token cache
- Schemas (3): list, get, create — full CRUD
- Datasets (3): list, get, create
- Identities (2): list namespaces, get identity graph
- Profiles (4): get, preview, get by identity, delete (with confirmation gate)
- Segments (4): list, get, create (PQL), estimate size
- Sources (2): list source catalog, list dataflows
- Destinations (2): list destination catalog, activate segment
- Query Service (3): run SQL, get query status, list queries
- Adobe-ecosystem-compatible metadata tagging via `describe()` helper
- Comprehensive live integration test suite
- Pino structured logging to stderr with PII/secret redaction
- Request timeout, retry with exponential backoff, 401 re-auth
- Circuit breaker on IMS auth failures (3 strikes / 30s cooldown)
- SSRF guard on absolute URLs
- Graceful shutdown handlers (SIGINT/SIGTERM)
- Correlation IDs and latency tracking on every API request
- Confirmation gate on destructive operations (delete-profile)
- `npm run tools` lists all 23 tools by category
