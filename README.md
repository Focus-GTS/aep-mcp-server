# @focusgts/aep-mcp-server

[![Tests](https://img.shields.io/badge/tests-33%20passing-brightgreen)]() [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]() [![License](https://img.shields.io/badge/license-proprietary-orange)]() [![MCP](https://img.shields.io/badge/MCP-1.12+-purple)]()

The first full-featured Model Context Protocol server for Adobe Experience Platform.
22 tools across 8 categories with full read AND write operations — built to extend
Adobe's read-only beta MCPs with production-grade capabilities.

---

## Why this exists

Adobe ships an official MCP server for Adobe Journey Optimizer, but it's a read-only
beta with three tools, broken pagination, and works only against Claude's hosted
remote-MCP transport. Nobody — not Adobe, not the community — has shipped a
full-featured MCP for **Adobe Experience Platform itself**.

That's the gap this fills. AEP is the foundation layer that AJO, Customer Journey
Analytics, and Real-Time CDP all sit on top of. Own the AEP MCP layer and you own
schemas, datasets, profiles, identities, segments, sources, destinations, and
SQL queries across the entire Adobe Experience Cloud — not just one product's
read-only slice.

This server is built to production standards: OAuth Server-to-Server auth with a
deduped token cache, structured pino logging with PII redaction, exponential-backoff
retries, automatic 401 re-auth, working pagination, structured `AEP_{status}`
error codes, and a graceful-shutdown lifecycle. It runs as a local stdio process
that any MCP-compliant client can drive.

---

## Comparison vs Adobe's own MCPs

| Feature | Adobe AJO MCP (beta) | @focusgts/aep-mcp-server |
|---------|---------------------|--------------------------|
| Operations | Read-only | Full CRUD (read + write) |
| Tool count | 3 | 22 |
| Pagination | Broken (first 50 only) | Working (offset/limit + hasMore) |
| Client compatibility | Claude only | Claude, Cursor, ChatGPT, Copilot, any MCP client |
| Transport | Hosted remote | stdio (local) |
| Sandbox support | Yes | Yes (auto-scoped) |
| Error responses | Sometimes 502 silent | Structured AEP_{status} codes |

---

## Tool inventory

22 tools across 8 categories. All prefixed `aep_` with `verb_noun` naming.

| Category | Tool | Description |
|----------|------|-------------|
| **Schemas** (3) | `aep_list_schemas` | List XDM schemas in the Schema Registry |
| | `aep_get_schema` | Fetch a single XDM schema by ID |
| | `aep_create_schema` | Create a new XDM schema (write) |
| **Datasets** (3) | `aep_list_datasets` | List datasets in the catalog |
| | `aep_get_dataset` | Fetch a single dataset by ID |
| | `aep_create_dataset` | Create a new dataset bound to a schema (write) |
| **Identities** (3) | `aep_list_namespaces` | List identity namespaces |
| | `aep_get_identity_graph` | Fetch the identity graph for a given identity |
| | `aep_get_profile_by_identity` | Look up a profile by namespace + identity value |
| **Profiles** (3) | `aep_get_profile` | Fetch a Real-Time CDP profile by entity ID |
| | `aep_preview_profile` | Preview a profile fragment without materializing |
| | `aep_delete_profile` | Delete a profile (write, confirmation gate) |
| **Segments** (3) | `aep_list_segments` | List segment definitions |
| | `aep_create_segment` | Create a PQL segment definition (write) |
| | `aep_estimate_segment_size` | Estimate segment audience size |
| **Sources** (2) | `aep_list_sources` | List the source connector catalog |
| | `aep_list_dataflows` | List active source dataflows |
| **Destinations** (2) | `aep_list_destinations` | List the destination catalog |
| | `aep_activate_segment` | Activate a segment to a destination (write) |
| **Query Service** (3) | `aep_run_query` | Run a SQL query against the Data Lake (write) |
| | `aep_get_query_status` | Check the status of a running query |
| | `aep_list_queries` | List recent queries |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  MCP Client (any)                        │
│      Claude · Cursor · ChatGPT · Copilot                │
└──────────────────────┬──────────────────────────────────┘
                       │ stdio (JSON-RPC 2.0)
┌──────────────────────┴──────────────────────────────────┐
│              @focusgts/aep-mcp-server                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Schemas  │  │ Datasets │  │Identities│  │Profiles│ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Segments │  │ Sources  │  │  Dests   │  │ Query  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
├─────────────────────────────────────────────────────────┤
│  Auth: OAuth 2.0 Server-to-Server (Adobe IMS)          │
│  Token cache · retry · 401 re-auth · pino redact       │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS + Bearer + x-sandbox-name
┌──────────────────────┴──────────────────────────────────┐
│        Adobe Experience Platform APIs (live)             │
│  /data/foundation/schemaregistry · /data/core/ups/...   │
└─────────────────────────────────────────────────────────┘
```

---

## Quickstart (5-minute install)

```bash
# 1. Install
npm install -g @focusgts/aep-mcp-server

# 2. Get Adobe credentials at developer.adobe.com/console
#    Create project → add "Experience Platform API" → OAuth Server-to-Server

# 3. Configure
cat > .env <<EOF
AEP_CLIENT_ID=your-client-id
AEP_CLIENT_SECRET=your-client-secret
AEP_ORG_ID=your-ims-org-id@AdobeOrg
AEP_SANDBOX_NAME=prod
EOF

# 4. Run
aep-mcp
```

The server speaks MCP over stdio. Any MCP-compliant client can drive it.

---

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "aep": {
      "command": "npx",
      "args": ["-y", "@focusgts/aep-mcp-server"],
      "env": {
        "AEP_CLIENT_ID": "...",
        "AEP_CLIENT_SECRET": "...",
        "AEP_ORG_ID": "...@AdobeOrg",
        "AEP_SANDBOX_NAME": "prod"
      }
    }
  }
}
```

### Cursor / Copilot / ChatGPT Desktop

Any MCP-compliant client works the same way — point its MCP config at
`npx -y @focusgts/aep-mcp-server` with the four env vars above.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AEP_CLIENT_ID` | Yes | Adobe I/O client ID |
| `AEP_CLIENT_SECRET` | Yes | Adobe I/O client secret |
| `AEP_ORG_ID` | Yes | IMS org ID (format: `xxx@AdobeOrg`) |
| `AEP_SANDBOX_NAME` | No | AEP sandbox name (default: `prod`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

---

## Entitlement matrix

Not every Adobe org has every AEP product entitlement. Map tools to what your
IMS org actually licenses:

| Tool category | Required Adobe entitlement |
|---------------|---------------------------|
| Schemas | AEP (base) |
| Datasets | AEP (base) |
| Identities | AEP (base) + Identity Service |
| Profiles | Real-Time CDP |
| Segments | Real-Time CDP |
| Sources | AEP (base) — connector availability varies by SKU |
| Destinations | Real-Time CDP (activation) |
| Query Service | AEP Query Service add-on |

If a tool returns `AEP_403` it usually means the entitlement is missing rather
than a credential problem.

---

## Development

```bash
npm install
npm run build        # tsc → dist/
npm run dev          # tsx src/server.ts (hot-reload)
npm test             # vitest (33 tests)
npm run typecheck    # tsc --noEmit
npm run clean        # rm -rf dist
```

The TypeScript config is `strict` mode end-to-end. All tool inputs are validated
with Zod at the boundary. All logs go to stderr (pino destination 2) — stdout is
reserved for the MCP JSON-RPC stream.

---

## Live integration testing

`npm run test:live` runs the integration suite against a real Adobe IMS org and
AEP sandbox. It exercises every tool against live endpoints with read-only
verification where possible and explicit confirmation gates for writes/deletes.

Requires a `.env` with valid credentials and `AEP_SANDBOX_NAME` pointing at a
non-production sandbox.

---

## Contributing & License

This is a Focus GTS proprietary product. See [LICENSE](./LICENSE).

Bug reports and feature requests are welcome at <dfox@focusgts.com>. Pull requests
are accepted by prior arrangement only — open an issue first.

---

## About Focus GTS

Focus GTS is an Adobe Silver Solution Partner specializing in Adobe Experience
Cloud talent and tooling. We build production-grade developer tools for AEP,
AJO, CJA, and Real-Time CDP customers who need more than what ships in the box.

Learn more at <https://focusgts.com>.
