# ADR-0002: Add Adobe Privacy Service tools as v0.2.0

- **Status**: Accepted
- **Date**: 2026-06-02
- **Deciders**: Dave Fox
- **Supersedes**: None
- **Related**: ADR-0001

## Context

v0.1.0 shipped 23 tools across 8 AEP categories (Schemas, Datasets, Identities,
Profiles, Segments, Sources, Destinations, Query Service). Twelve of those tools
sit behind entitlements (RTCDP, Query Service) that the Focus GTS partner
sandbox does not yet have provisioned, so they're not yet end-to-end testable
in our environment.

Meanwhile, **Adobe Experience Platform Privacy Service** IS provisioned on our
partner sandbox and validated working (live API returned 400 on a malformed
request and 404 on an empty job list — the right responses, not 403s).

Privacy Service has separate concerns from base AEP:

| Concern | Profile Service (existing) | Privacy Service (proposed) |
|---|---|---|
| API path | `/data/core/ups/access/entities` | `/data/core/privacy/jobs` |
| Entitlement | RTCDP | Privacy Service (standalone) |
| Use case | Read/write live profile data | Submit GDPR/CCPA jobs, track status |
| Audit guarantee | None — operates on Profile Service only | Full audit trail across all entitled Adobe products |
| Regulation awareness | None | 47 supported regulations (gdpr, ccpa, vcdpa_usa, hipaa_usa, lgpd_bra, etc.) |
| Compliance officer fit | Not for them | Designed for them |

`aep_delete_profile` (v0.1.0) is a Profile Service delete. Compliance teams
need Privacy Service jobs — different API, different audit trail, different
multi-product coverage.

Adobe's own MCP servers (AJO MCP, CJA MCP, AEM MCP) do NOT cover Privacy
Service. The community MCPs we found in research don't either. This is open
territory.

## Decision

Add six tools under a new `src/tools/privacy/` category, shipping as v0.2.0:

| Tool | HTTP | Endpoint |
|---|---|---|
| `aep_create_privacy_job` | POST | `/data/core/privacy/jobs` |
| `aep_get_privacy_job` | GET | `/data/core/privacy/jobs/{id}` |
| `aep_list_privacy_jobs` | GET | `/data/core/privacy/jobs` |
| `aep_cancel_privacy_job` | POST | `/data/core/privacy/jobs/{id}/cancel` |
| `aep_get_privacy_job_results` | GET | `/data/core/privacy/jobs/{id}/results` |
| `aep_list_privacy_namespaces` | GET | `/data/core/privacy/namespaces` |

### Tool Design Conventions

- **`regulation` is a required input** on tools where Adobe requires it. We
  surface it as a typed zod enum of the 47 supported values (extracted from
  the live API's 400 response). Eliminates a class of "forgot the regulation
  parameter" errors at the tool layer.

- **Reuse existing infrastructure**: same OAuth flow, same `AepClient`, same
  error sanitization, same logger, same metadata helper. No new transport,
  no new auth pattern, no new dependencies.

- **Product tagging**: `{ product: "Adobe Privacy Service", category: "Privacy",
  operation: "..." }` via `describe()`. Distinct from `Adobe Experience
  Platform` so agents can route correctly.

- **No confirmation gate on `aep_create_privacy_job`** despite it being a
  privacy operation. Reasoning: Privacy Service jobs are reversible (can be
  cancelled before execution), audit-trailed by Adobe natively, and the whole
  point of an MCP-driven privacy workflow is to make compliance work less
  manual. A confirmation gate would force humans into the loop on every job,
  defeating the use case. The `aep_cancel_privacy_job` tool provides the
  safety mechanism instead.

- **NO confirmation gate on `aep_get_privacy_job_results`** — read-only, safe.

## Consequences

### Positive

- First commercially-supported MCP server with Privacy Service coverage —
  marketable differentiator
- All six tools immediately testable in our partner sandbox (no waiting on
  entitlement provisioning)
- Compliance team self-service use case (top of v0.1.0 use cases list) now
  actually works end-to-end
- Adobe partnership pitch gets stronger ("we cover the gaps Adobe doesn't")
- ETLA-style compliance customers (financial services, healthcare) get a
  direct value prop

### Negative

- Total tool count grows from 23 to 29 — manageable, well under the ~100-tool
  ceiling where MCP servers start hurting agent reasoning
- Customer support burden: GDPR/CCPA semantics are jurisdiction-specific.
  We'll punt regulation-specific guidance to Adobe's docs and our own
  documentation rather than embedding it in tool descriptions
- Documentation drift risk: regulation enum changes if Adobe adds/removes
  supported regulations. Mitigation: tool calls fail loudly with Adobe's
  exact error message listing current supported values; users update via
  npm version bump

### Neutral

- Bumps version to v0.2.0 (minor — additive only, no breaking changes)
- Same env vars, same auth — no migration burden for existing users

## Alternatives Considered

### A. Skip Privacy Service, focus on AJO MCP next

Rejected. Privacy Service is provisioned and working in our sandbox right now.
AJO MCP requires a separate sandbox provisioning request (still pending) and a
much larger tool surface (~30+ tools). Privacy Service is six tools that ship
this week. Compounding return on the v0.1.0 investment beats greenfield work.

### B. Add Privacy tools alongside `aep_delete_profile` in `src/tools/profiles/`

Rejected. Privacy Service is a distinct product with its own entitlement,
audit guarantees, and conceptual model. Mixing it with Profile Service in
the same directory would confuse the tool inventory (`npm run tools` output),
the README inventory table, and the entitlement matrix. Separate directory =
separate category = clearer mental model.

### C. Build a separate `@focusgts/privacy-mcp-server` package

Rejected. Adds package management overhead for users (two installs, two env
configs, two MCP entries in their client config). Privacy Service uses the
exact same OAuth credentials as AEP. Splitting adds friction without benefit.
If we ever support multiple Adobe IMS orgs in one config, we'd revisit, but
that's a v1.0 conversation.

## Implementation Notes

- Follow the v0.1.0 swarm build pattern: parallel coder agents per tool category
- Add Privacy Service product entry to `src/util/metadata.ts` `AdobeProduct`
  union
- Update README inventory table and `npm run tools` output
- Update CLAUDE.md tool naming convention list
- Update CHANGELOG.md with v0.2.0 entry
- Live integration test (`tests/integration/live-test.ts`) gets new section:
  `[9/9] PRIVACY SERVICE`
