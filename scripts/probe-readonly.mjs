#!/usr/bin/env node
/**
 * Read-only AEP credential / entitlement probe.
 *
 * Issues GET requests ONLY. Never creates, updates, deletes, ingests, or
 * schedules anything. Safe to run against any sandbox, including production.
 *
 * Purpose: after provisioning a new OAuth Server-to-Server credential, confirm
 * which AEP API surfaces that credential can actually reach BEFORE running any
 * mutation test. A 403 means a missing product-profile permission; a 401 on a
 * specific API family usually means a missing SKU entitlement.
 *
 * Usage:
 *   node scripts/probe-readonly.mjs                     # reads process.env
 *   node scripts/probe-readonly.mjs --env-file .env     # loads a file first
 *   node scripts/probe-readonly.mjs --sandbox <DEVELOPMENT_SANDBOX>   # override sandbox
 *
 * Requires a build first: npm run build
 *
 * SECURITY: this script never prints credential values. The client secret is
 * never logged, echoed, or included in output. Client ID and org ID appear
 * truncated only.
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------- arg parsing

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const envFile = flag("env-file");
const sandboxOverride = flag("sandbox");

if (envFile) {
  let raw;
  try {
    raw = readFileSync(envFile, "utf8");
  } catch (err) {
    console.error(`Could not read --env-file ${envFile}: ${err.message}`);
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith("#")) {
      process.env[m[1]] = m[2];
    }
  }
}

if (sandboxOverride) process.env.AEP_SANDBOX_NAME = sandboxOverride;

// Keep the probe quiet — we render our own output. This must be forced AFTER
// --env-file is loaded, otherwise a LOG_LEVEL in that file wins and floods
// stderr with per-request pino lines. `--verbose` opts the noise back in.
process.env.LOG_LEVEL = argv.includes("--verbose") ? "debug" : "silent";

// ---------------------------------------------------------------- the probes

/**
 * Every entry is a GET. `gates` names what a failure most likely indicates,
 * so the operator can act on the result without cross-referencing docs.
 */
const PROBES = [
  {
    label: "Schema Registry",
    path: "/data/foundation/schemaregistry/tenant/schemas",
    query: { limit: 1 },
    headers: { Accept: "application/vnd.adobe.xed-id+json" },
    gates: "Data Modeling — View Schemas",
    tools: "aep_list_schemas, aep_get_schema, aep_create_schema, aep_update_schema",
  },
  {
    label: "Catalog / Datasets",
    path: "/data/foundation/catalog/dataSets",
    query: { limit: 1 },
    gates: "Data Management — View Datasets",
    tools: "aep_list_datasets, aep_get_dataset, aep_create_dataset",
  },
  {
    label: "Catalog / Batches",
    path: "/data/foundation/catalog/batches",
    query: { limit: 1 },
    gates: "Data Management — View Datasets (+ Data Ingestion to write)",
    tools: "aep_list_batches, aep_get_batch_status (+ the 3 ingest writes)",
  },
  {
    label: "Identity namespaces",
    path: "/data/core/idnamespace/identities",
    gates: "Identity Service (base AEP)",
    tools: "aep_list_identity_namespaces, aep_get_identity_graph",
  },
  {
    label: "Segment definitions",
    path: "/data/core/ups/segment/definitions",
    query: { limit: 1 },
    gates: "Real-Time CDP — View Segments",
    tools: "aep_list_segments, aep_get_segment, aep_create_segment",
  },
  {
    label: "Data Hygiene / work orders",
    path: "/data/core/hygiene/workorder",
    gates: "Data Distiller SKU + Data Governance permission",
    tools: "aep_create_record_delete, aep_get_work_order_status, aep_list_work_orders",
  },
  {
    label: "Data Hygiene / TTL",
    path: "/data/core/hygiene/ttl",
    gates: "Data Distiller SKU + Data Governance permission",
    tools: "aep_create_dataset_expiration, aep_list_dataset_expirations",
  },
  {
    label: "Query Service",
    path: "/data/foundation/query/queries",
    query: { limit: 1 },
    gates: "Query Service add-on",
    tools: "aep_run_query, aep_get_query_status, aep_list_queries",
  },
  {
    label: "Privacy Service",
    path: "/data/core/privacy/jobs",
    query: { regulation: "gdpr", limit: 1 },
    gates: "Adobe Privacy Service add-on",
    tools: "the 6 aep_*_privacy_* tools",
  },
  {
    label: "Datastreams (Edge)",
    path: "/data/core/edge/datastreams",
    query: { limit: 1 },
    gates: "Data Collection / Edge Network",
    tools: "the 5 aep_*_datastream tools",
  },
];

// ---------------------------------------------------------------- run

/**
 * A JSON 404 usually means "route exists, not provisioned for this org".
 * An HTML 404 means we never reached an API at all — the path itself is
 * likely wrong. Distinguishing the two matters: only the second is our bug.
 */
function interpret(status, detail) {
  if (status === 200) return "reachable";
  if (status === 401) return "NOT AUTHORIZED — likely a missing SKU entitlement";
  if (status === 403) return "FORBIDDEN — likely a missing product-profile permission";
  if (status === 404) {
    return /<html|<!doctype/i.test(detail ?? "")
      ? "NOT FOUND (HTML) — path likely wrong, did not reach an API"
      : "NOT FOUND — route not provisioned for this org, or wrong path";
  }
  return "unexpected";
}

async function main() {
  let loadCredentials, TokenCache, AepClient;
  try {
    ({ loadCredentials } = await import("../dist/auth/credentials.js"));
    ({ TokenCache } = await import("../dist/auth/token-cache.js"));
    ({ AepClient } = await import("../dist/auth/aep-client.js"));
  } catch {
    console.error("Could not load ../dist — run `npm run build` first.");
    process.exit(1);
  }

  let creds;
  try {
    creds = loadCredentials();
  } catch (err) {
    console.error(`Credential load failed: ${err.message}`);
    process.exit(1);
  }

  // Truncated identifiers only. The secret is never referenced here.
  console.log("AEP read-only probe — GET requests only, nothing is mutated\n");
  console.log(`  sandbox   ${creds.sandboxName}`);
  console.log(`  org       ${creds.orgId.slice(0, 8)}…`);
  console.log(`  client id ${creds.clientId.slice(0, 6)}…\n`);

  const tokenCache = new TokenCache(creds);
  try {
    await tokenCache.getToken();
    console.log("  IMS authentication: OK\n");
  } catch (err) {
    console.log(`  IMS authentication: FAILED — ${err.message}`);
    console.log("\n  Stopping. Fix authentication before probing endpoints.");
    process.exit(1);
  }

  const client = new AepClient(creds, tokenCache);
  const results = [];

  for (const probe of PROBES) {
    let status;
    let detail = "";
    try {
      await client.request({
        method: "GET",
        path: probe.path,
        query: probe.query,
        headers: probe.headers,
      });
      status = 200;
    } catch (err) {
      status = err?.status ?? 0;
      const body = err?.body;
      detail =
        typeof body === "object" && body
          ? (body.detail ?? body.message ?? body.title ?? "")
          : typeof body === "string"
            ? body
            : "";
    }
    const oneLine = String(detail).replace(/\s+/g, " ").trim().slice(0, 70);
    results.push({ ...probe, status, detail: oneLine });
    const mark = status === 200 ? "PASS" : "FAIL";
    console.log(
      `  ${mark}  ${String(status).padEnd(4)} ${probe.label.padEnd(26)} ${interpret(status, detail)}`,
    );
    if (oneLine) console.log(`              ${oneLine}`);
  }

  const ok = results.filter((r) => r.status === 200);
  console.log(`\n  ${ok.length}/${results.length} surfaces reachable\n`);

  const blocked = results.filter((r) => r.status !== 200);
  if (blocked.length) {
    console.log("  Blocked surfaces and what they gate:\n");
    for (const b of blocked) {
      console.log(`    ${b.label}  (HTTP ${b.status})`);
      console.log(`      needs : ${b.gates}`);
      console.log(`      blocks: ${b.tools}\n`);
    }
  }

  // Non-zero exit when anything is blocked, so CI/scripts can gate on it.
  process.exit(blocked.length === 0 ? 0 : 2);
}

main().catch((err) => {
  console.error("Probe failed:", err?.message ?? err);
  process.exit(1);
});
