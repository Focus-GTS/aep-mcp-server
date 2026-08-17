# AEP MCP Server — Claude Code Configuration

> This is the project memory. For user-facing docs, see [README.md](./README.md).

## What This Is

Full-featured MCP server for Adobe Experience Platform. 48 tools across 11 categories covering schemas, datasets, ingestion, identities, profiles, segments, sources, destinations, query service, privacy service, and data hygiene. AEP is the foundation that AJO, CJA, and RTCDP sit on top of — own this MCP layer and you own everything downstream.

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
    ├── index.ts           # registerAllTools() — wires all 11 categories
    ├── schemas/           # 4 tools: list, get, create, update XDM schemas
    ├── datasets/          # 4 tools: list, get, create, delete datasets
    ├── ingestion/         # 7 tools: batch create/upload/complete/status/list/abort/revert
    ├── identities/        # 2 tools: list namespaces, identity graph
    ├── profiles/          # 4 tools: get, get-by-identity, preview, delete profile
    ├── segments/          # 4 tools: list, get, create (PQL), estimate size
    ├── sources/           # 2 tools: list source catalog, list dataflows
    ├── destinations/      # 3 tools: list catalog, create connection, activate segment
    ├── query/             # 3 tools: run SQL, get status, list queries
    ├── privacy/           # 6 tools: GDPR/CCPA job management
    └── hygiene/           # 9 tools: record delete, work orders, quota, dataset expiration CRUD
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
| Ingestion | `/data/foundation/import/batches` |
| Data Hygiene | `/data/core/hygiene/workorder`, `/ttl`, `/quota` |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AEP_CLIENT_ID` | Yes | Adobe I/O client ID |
| `AEP_CLIENT_SECRET` | Yes | Adobe I/O client secret |
| `AEP_ORG_ID` | Yes | IMS org ID (format: xxx@AdobeOrg) |
| `AEP_SANDBOX_NAME` | **Yes** | AEP sandbox name. **No default** — it used to fall back to `prod`, which silently pointed every request at production |
| `AEP_ALLOW_MUTATIONS` | No | `true` to permit any write at all. Off by default |
| `AEP_MODE` | No | `read-only` / `safe` (default) / `production` |
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
- `aep_create_batch`, `aep_upload_batch_file`, `aep_complete_batch`, `aep_get_batch_status`, `aep_list_batches`, `aep_abort_batch`, `aep_revert_batch`
- `aep_create_record_delete`, `aep_get_work_order_status`, `aep_list_work_orders`, `aep_get_data_lifecycle_quota`, `aep_create_dataset_expiration`, `aep_get_dataset_expiration`, `aep_list_dataset_expirations`, `aep_update_dataset_expiration`, `aep_cancel_dataset_expiration`

**Removed in 0.9.0:** the five `aep_*_datastream` tools. They targeted a Platform path that does not exist; datastream config lives on Reactor. See `docs/adr/0005-remove-datastream-tools.md` — do not re-add them against `/data/core/edge/datastreams`.

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
