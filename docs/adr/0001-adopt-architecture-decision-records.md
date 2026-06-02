# ADR-0001: Adopt Architecture Decision Records

- **Status**: Accepted
- **Date**: 2026-06-02
- **Deciders**: Dave Fox

## Context

`@focusgts/aep-mcp-server` shipped v0.1.0 with significant architectural choices
embedded in the codebase but not documented anywhere durable. Examples that came
up during the v0.1.0 audit:

- Why OAuth Server-to-Server instead of JWT?
- Why stdio transport instead of remote HTTP?
- Why single-sandbox per server instance instead of per-tool sandbox argument?
- Why the `describe()` metadata helper for tool descriptions?
- Why a confirmation gate on `delete-profile` instead of a separate "force"
  parameter?
- Why error body whitelisting at the `AepApiError` constructor instead of at
  `mapApiError`?

These decisions were defensible but undocumented. As the project grows (Privacy
Service in v0.2.0, additional Adobe products planned, potential contributors,
Adobe partnership conversations), the cost of opaque decisions compounds.

## Decision

Adopt the [MADR](https://adr.github.io/madr/) format and maintain ADRs in
`docs/adr/` for all non-trivial architectural decisions going forward.

Definition of "non-trivial":

- Adding a new Adobe product surface (e.g., Privacy Service, Query Service)
- Changing transport, authentication, or core security posture
- Introducing a new abstraction that other tools must adopt
- Reversing a prior decision
- Anything that future-Dave would meaningfully benefit from knowing the *why*

Trivial things that do NOT need ADRs:

- Adding a single tool within an existing surface
- Bug fixes that don't change architecture
- Dependency upgrades
- Documentation changes

## Consequences

### Positive

- Decisions become discoverable for partners, contributors, and acquirers
- Adobe partnership conversations have a paper trail
- New maintainers can ramp up by reading `docs/adr/`
- Forces the discipline of articulating *why* before implementing

### Negative

- ~15 minutes of overhead per significant decision
- Risk of ADRs drifting from reality if not maintained
- Risk of over-documenting trivial choices (mitigated by the "non-trivial"
  bar above)

### Neutral

- Existing v0.1.0 decisions are NOT being retroactively documented. They are
  visible in code and PR history. If a future ADR reverses one of those
  decisions, the new ADR will document the prior implicit choice in its
  Context section.

## Related

- ADR-0002: Add Adobe Privacy Service tools as v0.2.0 (the first decision
  recorded under this process)
