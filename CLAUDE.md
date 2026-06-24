# AEP MCP Server — Claude Code Configuration

> This is the project memory. For user-facing docs, see [README.md](./README.md).

## What This Is

Full-featured MCP server for Adobe Experience Platform. 34 tools across 10 categories covering schemas, datasets, identities, profiles, segments, sources, destinations, query service, privacy service, and datastreams. AEP is the foundation that AJO, CJA, and RTCDP sit on top of — own this MCP layer and you own everything downstream.

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries (tool inputs via Zod)
- All logs MUST go to stderr (pino destination 2) — stdout is the MCP JSON-RPC stream

## Architecture

```
src/
├── server.ts              # Entry point — loads creds, creates client, registers tools
├── auth/
│   ├── credentials.ts     # Loads env vars, fails fast if missing
│   ├── token-cache.ts     # OAuth token with in-flight dedup refresh
│   └── aep-client.ts      # HTTP client with auto auth headers
├── util/
│   ├── errors.ts          # toolResult(), toolError(), mapApiError(), AepApiError
│   ├── logger.ts          # pino → stderr
│   └── pagination.ts      # Shared pagination schema + response builder
├── types/
│   ├── aep.ts             # All AEP entity types (XdmSchema, Dataset, Segment, etc.)
│   └── context.ts         # ToolContext interface
└── tools/
    ├── index.ts           # registerAllTools() — wires all 10 categories
    ├── schemas/           # 3 tools: list, get, create XDM schemas
    ├── datasets/          # 3 tools: list, get, create datasets
    ├── identities/        # 3 tools: list namespaces, identity graph, profile by identity
    ├── profiles/          # 3 tools: get, preview, delete profile
    ├── segments/          # 3 tools: list, create (PQL), estimate size
    ├── sources/           # 2 tools: list source catalog, list dataflows
    ├── destinations/      # 2 tools: list catalog, activate segment
    ├── query/             # 3 tools: run SQL, get status, list queries
    ├── privacy/           # 6 tools: GDPR/CCPA job management
    └── datastreams/    # 5 tools: list, get, create, update, delete datastreams
```

## Adobe AEP API Endpoints

| Category | Base Path |
|----------|-----------|
| Schemas | `/data/foundation/schemaregistry/` |
| Datasets | `/data/foundation/catalog/dataSets` |
| Identities | `/data/core/idnamespace/`, `/data/core/identity/` |
| Profiles | `/data/core/ups/access/entities` |
| Segments | `/data/core/ups/segment/definitions` |
| Sources | `/data/foundation/flowservice/sources`, `/connections` |
| Destinations | `/data/foundation/flowservice/destinations` |
| Query Service | `/data/foundation/query/queries` |
| Privacy Service | `/data/core/privacy/jobs`, `/data/core/privacy/namespaces` |
| Datastreams | /data/core/edge/datastreams |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AEP_CLIENT_ID` | Yes | Adobe I/O client ID |
| `AEP_CLIENT_SECRET` | Yes | Adobe I/O client secret |
| `AEP_ORG_ID` | Yes | IMS org ID (format: xxx@AdobeOrg) |
| `AEP_SANDBOX_NAME` | No | AEP sandbox name (default: prod) |
| `LOG_LEVEL` | No | Pino log level (default: info) |

## Tool Naming Convention

All tools prefixed with `aep_` followed by `verb_noun`:
- `aep_list_schemas`, `aep_get_schema`, `aep_create_schema`
- `aep_list_datasets`, `aep_get_dataset`, `aep_create_dataset`
- `aep_list_namespaces`, `aep_get_identity_graph`, `aep_get_profile_by_identity`
- `aep_get_profile`, `aep_preview_profile`, `aep_delete_profile`
- `aep_list_segments`, `aep_create_segment`, `aep_estimate_segment_size`
- `aep_list_sources`, `aep_list_dataflows`
- `aep_list_destinations`, `aep_activate_segment`
- `aep_run_query`, `aep_get_query_status`, `aep_list_queries`
- `aep_create_privacy_job`, `aep_get_privacy_job`, `aep_list_privacy_jobs`, `aep_cancel_privacy_job`, `aep_get_privacy_job_results`, `aep_list_privacy_namespaces`
- `aep_list_datastreams, aep_get_datastream, aep_create_datastream, aep_update_datastream, aep_delete_datastream`

## Build & Test

```bash
npm install
npm run build        # tsc → dist/
npm run dev          # tsx src/server.ts
npm test             # vitest
npm run typecheck    # tsc --noEmit
```

## Patterns

Same as AJO MCP — every tool file exports `register(server, ctx)`, uses zod schemas, returns `toolResult()` or `toolError(mapApiError(err))`, never throws.
