# @focusgts/aep-mcp-server

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![Tests](https://img.shields.io/badge/tests-57%20passing-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) ![Tools](https://img.shields.io/badge/tools-46-blue.svg) ![MCP](https://img.shields.io/badge/MCP-1.12+-purple)

**Adobe's MCP lets your agent read Experience Platform. This one lets it work.**

46 tools across 12 categories with full read AND write operations — batch ingestion,
schema composition, audience activation, data lifecycle, privacy jobs, and datastreams.
Self-hosted, Apache 2.0, no invitation required.

---

## Why this exists

Adobe now ships first-party Experience Platform tools through
[CX Coworker Gateway](https://experienceleague.adobe.com/en/docs/cx-enterprise-ai/experience-cloud-ai/mcp/overview),
its unified MCP endpoint for Adobe CX Enterprise. (Adobe does not brand any part of
it "the AEP MCP" — the gateway is one endpoint that surfaces a tool set per product.)
It is a genuinely good product, and if all you need is to *ask questions about* your
Experience Platform instance, you should use it.

But its [Experience Platform tool set](https://experienceleague.adobe.com/en/docs/cx-enterprise-ai/experience-cloud-ai/mcp/mcp-product-tools/aep-mcp)
is 8 tools, all read-only — the names are literally `search_*` — covering schemas,
datasets, governance, Query Service, and audit *discovery*. It does not touch
profiles, identity resolution, privacy requests, datastreams, or ingestion. Access is
**invitation-only, gated behind Adobe organization enablement**, and the whole surface
is still Beta.

Audiences and destinations do appear, but in a *separate* Real-Time CDP tool set on
the same gateway — and Adobe is explicit that creating, activating, updating, or
deleting audiences, destinations, and dataflows is not supported there either. The
read-only boundary holds across the whole gateway.

This server covers the other half: **the write path**, plus the surfaces Adobe's
gateway skips entirely. Ingest a batch. Compose a schema from field groups. Create a
destination connection and activate an audience to it. Submit a GDPR erasure. Route
Edge Network events. Then run it in your own VPC, under Apache 2.0, with nothing to
request from your account rep.

The two are complementary, not competing: **pair Adobe's gateway for governed reads
with this server for the write path.**

This server is built to production standards: OAuth Server-to-Server auth with a
deduped token cache, structured pino logging with PII redaction, exponential-backoff
retries, automatic 401 re-auth, working pagination, structured `AEP_{status}`
error codes, and a graceful-shutdown lifecycle. It runs as a local stdio process
that any MCP-compliant client can drive.

---

## Comparison vs Adobe's first-party Experience Platform tools

| Feature | Adobe AEP tools (CX Coworker Gateway) | @focusgts/aep-mcp-server |
|---------|---------------------------------------|--------------------------|
| Operations | **Read-only** (`search_*`) | **Full CRUD** (read + write) |
| AEP tool count | 8 | **46** |
| Access | **Invitation-only** + org enablement | `npm install` — any org with API credentials |
| Batch ingestion | Not available | 5 tools |
| Profiles / Identity | Not covered | 6 tools |
| Privacy Service | Not covered | 6 tools |
| Datastreams | Not covered | 5 tools |
| Data Lifecycle | Not covered | 5 tools |
| Transport | Adobe-hosted gateway | stdio (local, composes with other MCPs) |
| Data path | Queries traverse Adobe's gateway | Runs entirely in your own VPC |
| License | Proprietary | **Apache 2.0** |
| Client compatibility | Claude, ChatGPT, Cursor, Claude Code, Codex, VS Code | Any MCP-compliant client |
| Error responses | — | Structured `AEP_{status}` codes |

> Adobe's figures were read from
> [their Experience Platform tools page](https://experienceleague.adobe.com/en/docs/cx-enterprise-ai/experience-cloud-ai/mcp/mcp-product-tools/aep-mcp)
> (last updated 17 July 2026): `search_datasets`, `search_class_relations`,
> `search_data_access`, `search_data_lake`, `search_dule`, `search_query_service`,
> `search_audit`, `search_allowed_ip_ranges`. It is a Beta surface and will change —
> check their docs for the current figure. The read/write split is the durable
> difference, not the count.

---

## Tool inventory

**46 tools across 12 categories.** All prefixed `aep_` with `verb_noun` naming.
Tools marked 🔒 change state; 🔥 are destructive. Most destructive tools require an
explicit confirmation phrase — see [Safety model](#safety-model) for exactly which,
and for the two deliberate exceptions.

| Category | Tools |
|----------|-------|
| **Schemas** (4) | `list_schemas` · `get_schema` · `create_schema` 🔒 · `update_schema` 🔒 |
| **Datasets** (3) | `list_datasets` · `get_dataset` · `create_dataset` 🔒 |
| **Ingestion** (5) | `create_batch` 🔒 · `upload_batch_file` 🔒 · `complete_batch` 🔒 · `get_batch_status` · `list_batches` |
| **Identities** (3) | `list_identity_namespaces` · `get_identity_graph` · `get_profile_by_identity` |
| **Profiles** (3) | `get_profile` · `preview_profile` · `delete_profile` 🔥 *(deprecated — see Data Hygiene)* |
| **Segments** (4) | `list_segments` · `get_segment` · `create_segment` 🔒 · `estimate_segment_size` |
| **Sources** (2) | `list_sources` · `list_dataflows` |
| **Destinations** (3) | `list_destinations` · `create_destination_connection` 🔒 · `activate_segment` 🔒 |
| **Query Service** (3) | `run_query` 🔒 · `get_query_status` · `list_queries` |
| **Privacy Service** (6) | `create_privacy_job` 🔒 · `get_privacy_job` · `list_privacy_jobs` · `cancel_privacy_job` 🔒 · `get_privacy_job_results` · `list_privacy_namespaces` |
| **Data Hygiene** (5) | `create_record_delete` 🔥 · `get_work_order_status` · `list_work_orders` · `create_dataset_expiration` 🔥 · `list_dataset_expirations` |
| **Datastreams** (5) | `list_datastreams` · `get_datastream` · `create_datastream` 🔒 · `update_datastream` 🔒 · `delete_datastream` 🔥 |

### Workflows these unlock

**Ingest data end to end**
`create_schema` (with field groups) → `create_dataset` → `create_batch` → `upload_batch_file` → `complete_batch` → `get_batch_status`

**Build and activate an audience**
`create_segment` → `estimate_segment_size` → `list_destinations` → `create_destination_connection` → `activate_segment`

**Honour an erasure request**
`get_profile_by_identity` → `create_record_delete` → `get_work_order_status`

---

## Safety model

Writes are not uniformly gated — uniform gating makes an agent useless. Gates sit
where an action is irreversible and wide-reaching:

| Tool | Gate |
|---|---|
| `aep_delete_profile` | Requires `confirm: "I understand this is irreversible"` |
| `aep_create_record_delete` | Requires `confirm: "I understand this is irreversible"` |
| `aep_create_dataset_expiration` | Requires `confirm: "I understand this is irreversible"` — **unless `dryRun: true`** |
| `aep_delete_datastream` | **No gate** — deliberate, see [ADR-0003](./docs/adr/0003-add-data-collection-datastreams-tools.md) |

In every gated case the confirmation is checked **before any network call**, so a
rejected call never reaches Adobe. Rejections are logged at `warn`.

Dataset expiration is the one gate with a bypass: passing `dryRun: true` asks Adobe
to validate the request and report what *would* happen without scheduling anything,
so there is nothing to confirm. Any call that actually schedules deletion still
requires the phrase.

Datastream deletion is ungated on purpose: a datastream is configuration rather
than data, recreating one is the same POST body that created it, and gating it
would break the programmatic-cleanup use case the tool exists for.

Batch creation and file upload are ungated too. Those writes are additive and
recoverable — an unwanted batch can be left uncompleted, and data that did land
can be removed with the Data Hygiene tools.

Every tool validates inputs with Zod at the boundary and returns structured errors
rather than throwing. `aep_upload_batch_file` additionally rejects relative paths,
non-regular files, path-traversal file names, and oversized payloads before any
network call is made.

---

## Architecture

> v0.2.0 added Privacy Service for GDPR/CCPA workflows. v0.3.0 added Datastreams for Edge
> Network event routing. v0.4.0 adds Batch Ingestion and Data Hygiene — the write surfaces
> Adobe's read-only first-party MCP does not reach — and fixes the pagination and
> sandbox-scoping defects described in the changelog.

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
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Privacy  │  │Datastream│  │Ingestion │  │Hygiene │ │
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

## Quickstart

### Option A: From npm
```bash
npm install -g @focusgts/aep-mcp-server
```

### Option B: From source
```bash
git clone https://github.com/focusgts/aep-mcp-server.git
cd aep-mcp-server
npm install
npm run build
```

Then for both options:
```bash
# Get Adobe credentials at developer.adobe.com/console
# Create project → add "Experience Platform API" → OAuth Server-to-Server

cat > .env <<EOF
AEP_CLIENT_ID=your-client-id
AEP_CLIENT_SECRET=your-client-secret
AEP_ORG_ID=your-ims-org-id@AdobeOrg
AEP_SANDBOX_NAME=prod
EOF

# Run the server (Option A)
aep-mcp

# Or run from source (Option B)
npm run dev
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
| `AEP_SANDBOX_NAME` | No | AEP sandbox name (default: `prod`). Scopes every call, including Query Service. |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |
| `AEP_REQUEST_TIMEOUT_MS` | No | Per-request timeout (default: `30000`) |
| `AEP_MAX_RETRIES` | No | Retry attempts on 429/5xx (default: `3`) |

> **Sandbox scoping.** Every tool sends `x-sandbox-name`, and Query Service derives its
> database name as `<AEP_SANDBOX_NAME>:all`. Prior to v0.4.0 the Query Service database
> was hardcoded to `prod:all` regardless of this setting — see the changelog.


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
| Privacy Service | Adobe Privacy Service (sold separately from RTCDP/Query Service) |
| Ingestion | AEP (base) — Batch Ingestion is part of the core platform |
| Data Hygiene | Data Distiller / Data Hygiene add-on (dataset expiration may require Data Distiller) |
| Datastreams | AEP (base) + Data Collection / Edge Network |

If a tool returns `AEP_403` it usually means the entitlement is missing rather
than a credential problem.

---

## Development

```bash
npm install
npm run build        # tsc → dist/
npm run dev          # tsx src/server.ts (hot-reload)
npm test             # vitest (57 tests)
npm run typecheck    # tsc --noEmit
npm run clean        # rm -rf dist
```

The TypeScript config is `strict` mode end-to-end. All tool inputs are validated
with Zod at the boundary. All logs go to stderr (pino destination 2) — stdout is
reserved for the MCP JSON-RPC stream.

---

## Live integration testing

`npm run test:live` runs a smoke suite against a real Adobe IMS org and AEP
sandbox. It exercises the read paths across the schema registry, catalog,
identity, profile, segment, source, destination, query, and privacy endpoint
families to verify credentials, entitlements, and sandbox scoping end to end.

It is a connectivity and entitlement check rather than full per-tool coverage —
the newer Ingestion and Data Hygiene categories are not yet included, and no
destructive tool is invoked.

Requires a `.env` with valid credentials and `AEP_SANDBOX_NAME` pointing at a
non-production sandbox.

---

## Contributing & License

**Apache 2.0.** See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Built by [Focus GTS](https://focusgts.com), an Adobe Silver Solution Partner.
Independently developed — not affiliated with or endorsed by Adobe Inc. or
Anthropic, PBC.

Bug reports, feature requests, and pull requests are welcome. Open an issue at
[github.com/Focus-GTS/aep-mcp-server/issues](https://github.com/Focus-GTS/aep-mcp-server/issues)
or email <dfox@focusgts.com>.

---

## About Focus GTS

Focus GTS is an Adobe Silver Solution Partner specializing in Adobe Experience
Cloud talent and tooling. We build production-grade developer tools for AEP,
AJO, CJA, and Real-Time CDP customers who need more than what ships in the box.

Learn more at <https://focusgts.com>.
