# AEP MCP Server — Claude Code Configuration

## What This Is

Full-featured MCP server for Adobe Experience Platform. 22 tools covering schemas, datasets, identities, profiles, segments, sources, destinations, and query service. AEP is the foundation that AJO, CJA, and RTCDP sit on top of — own this MCP layer and you own everything downstream.

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
    ├── index.ts           # registerAllTools() — wires all 8 categories
    ├── schemas/           # 3 tools: XDM schema management
    ├── datasets/          # 3 tools: dataset CRUD + ingestion
    ├── identities/        # 3 tools: namespaces, graph lookup
    ├── profiles/          # 3 tools: profile lookup, preview, delete
    ├── segments/          # 3 tools: segment CRUD + size estimation
    ├── sources/           # 2 tools: source catalog + dataflows
    ├── destinations/      # 2 tools: destination catalog + activation
    └── query/             # 3 tools: SQL query service
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
- `aep_list_schemas`, `aep_create_schema`
- `aep_list_datasets`, `aep_ingest_data`
- `aep_get_profile`, `aep_preview_profile`
- `aep_run_query`, `aep_get_query_status`

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
