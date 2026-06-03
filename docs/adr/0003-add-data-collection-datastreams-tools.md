# ADR-0003: Add Adobe Experience Platform Data Collection (Datastreams) tools as v0.3.0

- **Status**: Accepted
- **Date**: 2026-06-03
- **Deciders**: Dave Fox
- **Supersedes**: None
- **Related**: ADR-0001, ADR-0002

## Context

After v0.2.0 (Privacy Service, 29 tools across 9 categories), the AEP MCP server
can manage schemas, datasets, profiles, segments, query service, and privacy
jobs — but it has no way to **deliver data to or from the live web/mobile
edge**.

That gap matters because:

- Every AJO Decisioning use case requires a **datastream** to route data
  from the customer's web/mobile property through the Adobe Edge Network
  to the right Adobe service (AJO, Target, Analytics, AEP)
- Every "wire up Web SDK / Mobile SDK / Edge Network" question from
  customers maps to "configure a datastream"
- The AJO MCP we'll build next (when the Charlie sandbox unblocks)
  is materially less useful without datastreams — customers will want
  to provision the end-to-end pipeline from one MCP-driven workflow

Today nobody — not Adobe, not the community, not the indie MCPs we
researched — exposes datastream management via MCP. The Reactor API
(now called Data Collection API) is well-documented, public, and uses
the same OAuth Server-to-Server pattern we already use.

Our partner sandbox has **AEP Data Collection provisioned and validated**
working (visible in the Admin Console with 1 user). So we can build
and test this end-to-end today, no Charlie-sandbox dependency.

## Decision

Add five tools under a new `src/tools/datastreams/` category, shipping as v0.3.0:

| Tool | HTTP | Endpoint |
|---|---|---|
| `aep_list_datastreams` | GET | `/data/core/edge/datastreams` |
| `aep_get_datastream` | GET | `/data/core/edge/datastreams/{id}` |
| `aep_create_datastream` | POST | `/data/core/edge/datastreams` |
| `aep_update_datastream` | PUT | `/data/core/edge/datastreams/{id}` |
| `aep_delete_datastream` | DELETE | `/data/core/edge/datastreams/{id}` |

### Tool Design Conventions

- **Reuse existing infrastructure**: same OAuth flow, same `AepClient`, same
  error sanitization, same logger, same metadata helper. No new transport,
  no new auth pattern, no new dependencies.

- **Product tagging**: `{ product: "Adobe Experience Platform", category: "Datastreams",
  operation: "..." }` via `describe()`. Datastreams are a core AEP feature
  (Data Collection is sold as a base AEP capability), so the product tag is
  "Adobe Experience Platform" — not a separate Data Collection product.

- **No confirmation gate on `aep_delete_datastream`** even though it's destructive.
  Reasoning: datastreams are configuration objects, not user data. Recreating
  one is trivial (the same POST body that created it). Adding a confirmation
  gate would defeat the use case of agents that programmatically clean up
  test/stale datastreams. The destructive-action signal stays in the
  `destructive: true` metadata flag.

- **`aep_update_datastream` uses PUT (full replacement)**, matching Adobe's
  Reactor API. We surface the full body shape in the schema and document
  that callers must read-then-update rather than patch. A future v0.4.0
  may add `aep_patch_datastream` if Adobe ever exposes PATCH on this
  endpoint, but PUT is the contract today.

- **Datastream config shape is opaque** in the tool inputs. The Reactor
  API accepts a deeply nested config object specifying which Adobe services
  to route to (AJO, Target, Analytics, AEP, Audience Manager), event
  forwarding rules, identity overrides, third-party ID sync, and edge
  geo-pinning. We surface this as `config: z.record(z.unknown())` rather
  than typing every possible service config. The richer typing comes when
  we wire in the auto-completion (post-v0.3.0).

## Consequences

### Positive

- Closes the "data doesn't reach the web/mobile" gap in our coverage
- Completes the AJO story for v0.4.0 (when Charlie unblocks): one MCP-driven
  workflow can now build a schema → dataset → segment → AJO decision →
  destination activation AND wire it to a datastream so the web/mobile
  property actually receives the decision
- Testable end-to-end on the existing sandbox today — no Charlie dependency
- First MCP server with datastream coverage — research turned up zero
  competitors
- Maintains the v0.1.0-v0.2.0 pattern: every release adds a complete
  surface, not a single tool

### Negative

- Tool count grows from 29 to 34 — still well under any agent-reasoning
  ceiling (~100)
- Reactor API has been renamed/rebranded multiple times (Launch → Tags →
  Data Collection). Documentation drift is real. Our endpoint paths come
  from current Adobe docs but we should validate against live calls before
  shipping.
- Datastream config shape is large and changes when Adobe adds services.
  Our opaque `z.record()` schema means input validation is weaker than
  for typed tools. Documented trade-off.

### Neutral

- Bumps version to v0.3.0 (minor — additive only, no breaking changes)
- Same env vars, same auth — no migration burden for existing users

## Alternatives Considered

### A. Wait for Charlie sandbox access and build AJO MCP first

Rejected. Adobe Sandbox Team has not responded to the access request,
and "wait on Adobe" is not a strategy. Datastreams ship today; AJO
ships when access lands. The two combine perfectly in v0.4.0.

### B. Build full Data Collection coverage (Tags, Properties, Rules,
Extensions, Libraries) in one ADR

Rejected. That's 12-15 additional tools and significantly more API
surface area. Datastreams are the highest-leverage subset because they
unblock AJO/AEP delivery on the web. Tags-and-properties are useful but
narrower (only matter if the customer is using client-side Adobe Launch,
not Web SDK directly). We can file ADR-0004 for tags/properties later if
demand emerges.

### C. Add datastream-as-a-side-effect of segment activation

Rejected. Datastream lifecycle is independent of segment activation —
they're created once, used for many activations, updated rarely. Coupling
them to activate-segment would be confusing.

### D. Build a separate `@focusgts/aep-edge-mcp-server` package

Rejected. Same OAuth credentials, same sandbox routing, same conceptual
domain (AEP). Splitting adds friction without benefit. Customers already
expect AEP capabilities in `@focusgts/aep-mcp-server`.

## Implementation Notes

- Follow the v0.2.0 swarm build pattern: parallel coder agents for
  source files and docs/version updates
- No new entry in `src/util/metadata.ts` `AdobeProduct` union (uses
  existing "Adobe Experience Platform")
- New "Datastreams" entry in `ToolCategory` union
- Add `Datastream` interface to `src/types/aep.ts` (with `config` as
  opaque `Record<string, unknown>`)
- Update README inventory table and `npm run tools` output
- Update CLAUDE.md tool naming convention list
- Update CHANGELOG.md with v0.3.0 entry
- Live integration test (`tests/integration/live-test.ts`) gets new
  section: `[10/10] DATASTREAMS`
- Add small unit-test coverage for `aep_delete_datastream` ID encoding
  (mirroring `aep_delete_profile` confirmation-gate test pattern from
  v0.2.0 but for URL encoding instead of confirmation)
