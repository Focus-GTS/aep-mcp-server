# ADR-0004: Reposition against Adobe's first-party MCPs; write operations as the durable moat

- **Status**: Accepted
- **Date**: 2026-08-07
- **Deciders**: Dave Fox
- **Supersedes**: None
- **Related**: ADR-0001, ADR-0002, ADR-0003

## Context

v0.1.0 through v0.3.1 were built and positioned against a specific competitive
claim, stated in the README and in ADR-0003: *nobody — not Adobe, not the
community — has shipped a full-featured MCP for Adobe Experience Platform.*

That claim is no longer true. It did not decay — it was falsified, and the
strategy resting on it has to be replaced now rather than at the next release.

What changed:

- **Adobe shipped a first-party AEP MCP in July 2026.** The
  [CX Coworker Gateway](https://experienceleague.adobe.com/en/docs/cx-enterprise-ai/experience-cloud-ai/mcp/overview)
  covers Experience Platform directly. Our headline claim — that nobody had
  shipped an AEP MCP — died with it. This is the single fact driving this ADR.
- **Adobe is shipping first-party MCPs quickly.** The AJO MCP we benchmarked
  against as a "read-only beta with three tools" is no longer representative of
  where Adobe is heading. Adobe shipped a 73-tool Workfront MCP to GA in June
  2026. The assumption that Adobe moves slowly on MCP is dead.
- **But the first-party AEP MCP is read-only.** Every AEP tool in it is a
  `search_*` or `inspect_*`. It does not touch profiles, identity resolution,
  privacy requests, or datastreams, and it cannot write anything. It is also
  invitation-only, gated behind Adobe organization enablement. So the thing
  that falsified our headline claim simultaneously confirmed the thesis
  replacing it.
- **"We have more tools" is not defensible.** Tool count is the easiest thing
  for a first-party vendor to match. They have more engineers, better API
  access, and no reverse-engineering tax. Any positioning that reduces to a
  bigger number loses on a schedule Adobe controls.
- **"Nobody else has built this" is a statement about a moment, not a moat.**
  It was our headline. It has a shelf life measured in months, and we cannot
  see Adobe's roadmap.

What did *not* change, and is the actual asymmetry:

Adobe's first-party MCPs are **structurally read-only**. That is not a
temporary product gap they will close next quarter — it follows from their
position. A vendor shipping an agent-driven tool that can delete a customer's
production profile data, schedule dataset expiry, or push records into a live
tenant owns the blast radius of every agent hallucination, in their own
product, under their own brand, for their largest enterprise accounts. The
liability and support calculus that makes write operations easy for a
third-party integrator makes them very hard for the first party.

So the surfaces Adobe is least likely to reach are exactly the ones that
change customer data: Data Hygiene record deletes, dataset expirations, batch
ingestion, destination connection creation, schema mutation.

## Decision

**Reposition the project from "the first/biggest AEP MCP" to "the write layer
for AEP that Adobe's own MCPs structurally cannot be."**

Three concrete commitments follow.

### 1. Write operations are the product

Prioritize tool categories by whether they mutate tenant state, not by how
many tools they add. A five-tool write category outranks a fifteen-tool read
category. v0.4.0 reflects this: Batch Ingestion (write data in), Data Hygiene
(delete data out), destination connection creation, and schema mutation.

### 2. Stop making claims with a shelf life

Remove "first", "only", and "nobody else has" from README, package
description, and marketing surfaces. Replace competitive claims that decay
with capability claims that are checkable: what the tools do, which are
verified against a live sandbox, which are not.

Corollary: **before building any new `@focusgts/*-mcp-server`, check Adobe's
current first-party MCP registry.** The gap-filling strategy requires a fresh
check each time, not a cached belief from a prior quarter.

### 3. Safety is part of the moat, not overhead

If write operations are the differentiator, then being trustworthy with writes
is the product quality that matters. The confirmation gate, the pre-network
rejection, the sanitized error bodies, the no-retry-on-non-idempotent-timeout
rule — these stop being hygiene and start being the reason a customer lets an
agent near their tenant at all.

This also means we hold ourselves to honest disclosure about what we have and
haven't verified. A tool built from documentation alone says so in its own
description. Overstating verification on a tool that deletes customer data
would destroy exactly the trust this strategy depends on.

## Consequences

### Positive

- The positioning stops depending on a fact we don't control and can't
  monitor. "We do writes, they do reads" is checkable by anyone and rooted in
  a structural asymmetry rather than a head start.
- Roadmap prioritization gets a clear tiebreaker: does it mutate tenant state?
- Adobe shipping more first-party MCPs becomes *less* threatening rather than
  more — a richer Adobe read layer makes a complementary write layer more
  useful, not redundant.
- Forces the README accuracy work that was overdue anyway. The tool counts had
  drifted across three categories and the test badge was reporting a number
  that no longer matched the suite.

### Negative

- We give up the strongest headline we had. "The first full-featured AEP MCP"
  converts better than "the write layer", and we're trading a marketing asset
  for a durable one.
- Concentrating on write surfaces concentrates risk. Every category we
  prioritize now is one where a bug destroys customer data rather than
  returning a wrong list. Test and review burden goes up per tool.
- Some write surfaces need entitlements (Data Distiller for Data Hygiene) that
  not every prospect has, so the differentiated tools are unusable for part of
  the addressable market.
- If Adobe does decide to accept the write liability, the moat narrows. This
  is a bet on their incentives, not a guarantee.

### Neutral

- No code change is required by this ADR itself. It reprioritizes the roadmap
  and rewrites the documentation; v0.4.0's tools were already consistent with
  it.
- Ships as part of v0.4.0 (minor — additive, no breaking changes).

## Alternatives Considered

### A. Keep the "first/biggest" positioning and race on tool count

Rejected. It's a race against a better-resourced first party with superior API
access, on a metric they can match trivially. And the claim requires constant
re-verification against a roadmap we can't see — we'd be one Adobe release away
from our own README being false.

### B. Reposition around multi-client support (Cursor, ChatGPT, Copilot vs Claude-only)

Rejected as the *primary* frame, kept as a supporting point. Adobe's hosted
remote-MCP transport limitation is real but is an implementation choice, not a
structural one. They can ship stdio whenever they choose. It's a weaker moat
than write operations, though still worth stating.

### C. Narrow to a single vertical (privacy/compliance tooling only)

Rejected. Data Hygiene and Privacy Service are the strongest categories, and a
compliance-focused product is a coherent business. But it discards the batch
ingestion and destination surfaces that make the server useful day-to-day, and
compliance-only tools get evaluated against dedicated compliance vendors rather
than against Adobe's MCP. Better to be the write layer that includes
compliance.

### D. Contribute the tools upstream to Adobe

Rejected for now. It would resolve the competitive question permanently but
forfeits the business, and Adobe's read-only posture suggests they would not
accept the write surfaces regardless — which is the whole thesis.

## Implementation Notes

- README: remove "first"/"only"/"nobody has" claims; lead with read+write
  asymmetry; fix the drifted per-category counts (Schemas, Identities,
  Profiles, Destinations) and the stale tools and tests badges
- package.json description: drop the hardcoded tool count so it stops going
  stale between releases
- Mark `aep_delete_profile` deprecated in favour of `aep_create_record_delete`,
  keeping its confirmation gate intact
- Comparison table: reframe from "tool count 3 vs 34" to operation coverage
- Every tool built from documentation alone carries a "validate against your
  own sandbox" note in its description until someone verifies it live
