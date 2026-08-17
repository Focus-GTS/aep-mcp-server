# 0005 — Remove the datastream tools; datastream configuration lives on Reactor, not Platform

- **Status:** Accepted
- **Date:** 2026-08-17
- **Supersedes:** [0003 — Add Adobe Data Collection (Datastreams) tools as v0.3.0](./0003-add-data-collection-datastreams-tools.md)
- **Shipped in:** v0.9.0

## Context

ADR-0003 added five datastream tools in v0.3.0, targeting `/data/core/edge/datastreams` on `platform.adobe.io`. That path was never verified against a live tenant — it was inferred from Adobe's Datastreams documentation, which describes a UI workflow and does not publish a REST API.

A read-only validation pass on 2026-08-12 reported an HTML 404 from the datastream surface. The investigation that followed ([`docs/datastream-endpoint-investigation-2026-08-12.md`](../datastream-endpoint-investigation-2026-08-12.md)) established two things: Adobe's public documentation describes no datastream configuration API, and — more embarrassingly — the failing probe had used `/data/foundation/edge/datastreams`, a path **no tool uses**. The probe and the code disagreed, so its failure said nothing about the tools. That was fixed by extracting `paths.ts` and adding a contract test, but the tools themselves remained entirely unvalidated.

That investigation was documentation-only, by instruction, and closed with the ambiguity unresolved: "None of this is resolvable without either Adobe confirmation or a live probe against a working credential."

On 2026-08-17 a working credential became available.

## Decision

**Remove all five datastream tools.** Not deprecate, not disable — remove. The tool surface drops from 53 to 48.

## What the live probe found

Six candidate paths, GET only:

| Host + path | Result |
|---|---|
| `platform.adobe.io/data/core/edge/datastreams` — **what the tools used** | HTML 404 |
| `platform.adobe.io/data/foundation/edge/datastreams` | HTML 404 |
| `platform.adobe.io/data/core/datastreams` | HTML 404 |
| `platform.adobe.io/data/core/edge/config/datastreams` | HTML 404 |
| `edge.adobe.io/data/core/edge/datastreams` | HTML 404 |
| **`reactor.adobe.io/edge_configurations`** | **JSON** 404 |

The distinction between an HTML 404 and a JSON 404 is the whole finding. Adobe's gateway answers unknown paths with an HTML error page; a service that exists answers in JSON even when it refuses you. Every `platform.adobe.io` candidate returned HTML, which means **no credential, entitlement, or sandbox could ever have made these tools work.** They were not blocked. They were pointed at nothing.

Reactor answered in JSON, so it was probed properly with JSON:API headers:

```
GET https://reactor.adobe.io/companies
403  {"code":"api-key-invalid","title":"API key is invalid"}
```

Reactor returns `api-key-invalid` when the client ID is not provisioned for the service. The Adobe Developer Console confirmed it: in the project holding this credential, with the availability filter set to **All**, **Experience Platform Launch API** appears in the catalogue **greyed out and unselectable**. Launch is Reactor. Reactor owns `edge_configurations`, which is what a datastream is called on the wire.

Four independent signals, one conclusion.

## Why removal rather than waiting for the entitlement

The tempting option was to leave the tools in place, ask Adobe to enable Launch, and re-enable them when it landed. That fails on a detail:

**The existing code would still not work.** It calls a path that does not exist on any tenant. Granting the Launch entitlement makes `reactor.adobe.io` reachable; it does not conjure a route at `platform.adobe.io/data/core/edge/datastreams`. There is no future state in which these five tools begin functioning.

So the choice was never "remove or wait". It was "remove, or keep five tools that can never succeed while their presence implies otherwise". A tool that always fails is worse than an absent one: it appears in `tools/list`, an agent selects it, and the failure surfaces as a confusing gateway error rather than "this capability does not exist here".

Rebuilding on Reactor is a rewrite, not a path swap:

- different host (`reactor.adobe.io`)
- different auth provisioning (Launch, not Experience Platform)
- JSON:API envelope — `data`/`attributes`/`relationships`, `Accept: application/vnd.api+json;revision=1`
- **company-scoped, not sandbox-scoped** — which does not fit the `x-sandbox-name` model every other tool in this server uses

That last point matters most, and is the reason the type definition was deleted rather than left in place. `Datastream` described a response shape from an endpoint that never responded. Restoring it from git history would be restoring fiction; the replacement must be written from real Reactor responses.

## Consequences

**Good**

- Every remaining tool has a route that exists. Nothing in the surface is a landmine.
- The validation matrix no longer has to carry a category marked "experimental, endpoint unsupported" — an admission that five advertised tools did not work.
- The distinction learned here (HTML 404 = no route; JSON error = route exists, you are refused) is now a documented diagnostic, and is worth applying to any future surface.

**Bad**

- A capability regression for anyone who installed v0.3.0–v0.8.1 expecting datastream tools. Mitigated by them never having worked: no user can have a working integration to break.
- Edge Network event routing is no longer represented in the tool surface at all.

**Follow-up**

- Request that Adobe enable **Experience Platform Launch API** on the organization holding this credential.
- When granted: probe Reactor's real `edge_configurations` responses, then write new tools against them — company-scoped, JSON:API — rather than adapting the deleted ones.
- A test asserts no tool name contains `datastream` and that the validation matrix documents no Datastreams category, so they cannot return by accident against the dead path.

## Notes

The five tools were never live-validated in any release that shipped them. The validation matrix said so plainly from 2026-08-16 onward, and said "experimental — do not demo them". This ADR makes that permanent rather than a caveat a reader has to find.
