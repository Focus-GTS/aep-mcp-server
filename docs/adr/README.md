# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for the
`@focusgts/aep-mcp-server` project.

We use the [MADR](https://adr.github.io/madr/) format — short, structured
markdown that captures the *why* behind significant architectural choices.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](./0001-adopt-architecture-decision-records.md) | Adopt Architecture Decision Records | Accepted | 2026-06-02 |
| [0002](./0002-add-privacy-service-tools.md) | Add Adobe Privacy Service tools as v0.2.0 | Accepted | 2026-06-02 |
| [0003](./0003-add-data-collection-datastreams-tools.md) | Add Adobe Data Collection (Datastreams) tools as v0.3.0 | Accepted | 2026-06-03 |

## Conventions

- ADRs are numbered sequentially: `NNNN-kebab-case-title.md`
- Status values: `Proposed` · `Accepted` · `Deprecated` · `Superseded by ADR-####`
- Each ADR is short — context, decision, consequences. No more.
- Once Accepted, ADRs are immutable except for `Status` changes (use Superseded if reversing)
- File a new ADR when reversing or significantly altering a prior decision

## Process

1. Open a PR with a new ADR in `Proposed` status
2. Discuss in the PR — the ADR is the source of truth, not chat
3. Merge when consensus reached, flip status to `Accepted`
4. Reference the ADR ID in commit messages and code comments where relevant
