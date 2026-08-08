# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
