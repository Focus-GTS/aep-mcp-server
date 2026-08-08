# Contributing to @focusgts/aep-mcp-server

Thanks for your interest in contributing. This is an MCP server that performs
**real write operations against production Adobe Experience Platform tenants**.
That shapes almost every convention below — a bug here can delete a customer's
data, not just crash a process.

---

## Getting set up

```bash
git clone https://github.com/Focus-GTS/aep-mcp-server.git
cd aep-mcp-server
npm install
cp .env.example .env    # fill in your own Adobe I/O credentials
```

You need an Adobe I/O project with an **OAuth Server-to-Server** credential and
the AEP API added. Required environment variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `AEP_CLIENT_ID` | Yes | Adobe I/O client ID |
| `AEP_CLIENT_SECRET` | Yes | Adobe I/O client secret |
| `AEP_ORG_ID` | Yes | IMS org ID, format `xxx@AdobeOrg` |
| `AEP_SANDBOX_NAME` | No | Defaults to `prod` — **point this at a dev sandbox** |
| `LOG_LEVEL` | No | pino level, defaults to `info` |

**Never** point your local `.env` at a production sandbox while developing.
`.env` is gitignored; keep it that way.

### Commands

```bash
npm run dev          # run the server under tsx
npm run typecheck    # tsc --noEmit — must pass
npm test             # vitest run — must pass
npm run build        # tsc → dist/
npm run tools        # print the registered tool inventory
npm run test:live    # integration tests against a REAL sandbox (see below)
```

CI runs `typecheck`, `test`, and `build` on every push and PR to `main`.
All three must be green before review.

---

## Adding a tool

Tools live in `src/tools/<category>/<verb-noun>.ts`. Read an existing tool in
the category you're extending before writing a new one — consistency matters
more than personal preference here.

Every tool file follows the same shape:

1. Export a single `register(server: McpServer, ctx: ToolContext): void`.
2. Define `TOOL_NAME` and `TOOL_DESCRIPTION` as module constants.
3. Build the description with `describe()` from `src/util/metadata.ts`, tagging
   product, category, and operation.
4. Define inputs as a Zod schema object with `.describe()` on **every** field —
   the description is what the agent reads to decide how to call you.
5. Wrap the API call in `try`/`catch`. Return `toolResult(...)` on success and
   `toolError(mapApiError(err))` on failure.
6. Register the tool from the category's `index.ts`, and register the category
   from `src/tools/index.ts`.

### Non-negotiables

- **Never throw out of a tool handler.** Return `toolError(...)`. A thrown
  error breaks the MCP session; a returned error lets the agent recover.
- **Never `console.log`.** stdout is the JSON-RPC stream — writing to it
  corrupts the protocol. Use `logger` from `src/util/logger.ts`, which is
  pino bound to stderr.
- **Never log secrets or PII.** Tokens, credentials, identity values, and raw
  API error bodies stay out of `info`-level logs. `AepApiError` sanitizes
  response bodies at construction; don't defeat it by logging raw responses.
- **Validate at the boundary.** Zod schemas are the trust boundary. Don't
  accept `z.any()` where a real shape is knowable.
- **Keep files under 500 lines.**
- **TypeScript strict.** No `any` escapes, no `@ts-ignore` without a comment
  explaining why.

### Naming

`aep_` + `verb_noun`, snake_case: `aep_list_datasets`, `aep_create_schema`,
`aep_get_work_order_status`. The verb should match the `operation` metadata
(`read` / `write` / `delete` / `execute`).

### Pagination

List tools take `...paginationSchema` and return
`buildPaginatedResponse(results, { limit, offset }, hints)`.

Pass a `total` in `hints` **only when the API genuinely returned a total across
all pages**. Several AEP endpoints return a `count` meaning "records on this
page" — passing that as `total` makes `hasMore` permanently false, which is a
bug this project has already had once. When in doubt, omit it and let the
short-page heuristic decide.

---

## Destructive tools

A tool is destructive if invoking it can destroy customer data that cannot be
reconstructed from configuration.

Destructive tools **must**:

- Set `destructive: true` in their `describe()` metadata.
- Require a `confirm` input that exactly equals
  `"I understand this is irreversible"`.
- Check the confirmation **before any API call**, return
  `toolError({ code: "CONFIRMATION_REQUIRED", ... })` on mismatch, and
  `logger.warn` the rejection.
- State the confirmation requirement in the tool description, so the agent
  learns the contract by reading rather than by failing.

See `src/tools/hygiene/create-record-delete.ts` for the canonical pattern.

Two deliberate exceptions to keep in mind:

- **Configuration objects don't need a gate.** `aep_delete_datastream` deletes
  a config object that can be recreated from the same POST body that made it.
  Gating it would block legitimate cleanup automation. The `destructive: true`
  flag carries the signal instead. (See ADR-0003.)
- **Dry runs don't need a gate.** `aep_create_dataset_expiration` skips the
  confirmation when `dryRun: true`, because nothing is scheduled or deleted.

---

## Endpoints we haven't verified

Some tools are built from Adobe's published API documentation without having
been exercised against a live sandbox. Adobe's docs drift — paths get renamed,
envelopes change shape between revisions.

If you add a tool you have not run against a real tenant, say so in the tool
description ("validate against your own sandbox before relying on it in
production"). Do not quietly imply verification you don't have. If you *do*
verify a previously unverified endpoint, remove the note in the same PR.

---

## Tests

Unit tests live in `tests/unit/`, mirroring the `src/` layout. Vitest.

Every new tool should have at least:

- One test that the happy path returns a `toolResult`.
- One test that an API failure returns a `toolError` rather than throwing.
- For destructive tools: a test that a missing or wrong `confirm` is rejected
  **without** the HTTP client being called. Assert on the mock, not just the
  return value — "rejected before the API call" is the whole security property.

`npm run test:live` hits a real sandbox and is **not** part of CI. Run it
yourself, against a dev sandbox, before shipping anything that writes.

---

## Pull requests

1. Branch off `main`.
2. Keep the PR scoped to one logical change — a tool category, a bug fix, a
   refactor. Not all three.
3. Make sure `npm run typecheck && npm test && npm run build` all pass locally.
4. Update the docs your change invalidates in the **same** PR:
   - `README.md` tool inventory and counts
   - `CHANGELOG.md` under `[Unreleased]`
   - `CLAUDE.md` tool naming list, if you added tools
   - A new ADR, if you made an architectural decision
5. Describe what you tested, and what you didn't. "Not verified against a live
   sandbox" is an acceptable and useful thing to write in a PR.

### Commit messages

Imperative mood, present tense, explaining *why* where it isn't obvious.
Reference an ADR ID when the change implements one.

---

## Architecture Decision Records

Significant or hard-to-reverse choices get an ADR in `docs/adr/`, in
[MADR](https://adr.github.io/madr/) format. See `docs/adr/README.md` for the
numbering and status conventions.

File one when you're adding a whole tool category, changing an established
convention, taking on a new dependency, or reversing a prior decision. Don't
file one for a bug fix.

---

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).

---

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, matching the project [LICENSE](./LICENSE).
