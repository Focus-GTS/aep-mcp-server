# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
