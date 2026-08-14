#!/usr/bin/env node
/**
 * Phased live-mutation runner for focusgts-ucp.
 *
 * Executes ONLY the phases named on the command line, and only those Dave has
 * approved. Maintains a run ledger of every object this run created, so
 * cleanup can never be driven by a name search across a SHARED sandbox.
 *
 *   node scripts/phase-runner.mjs --env .env --phase 0
 *   node scripts/phase-runner.mjs --env .env --phase 1a
 *   node scripts/phase-runner.mjs --env .env --phase 1b     (requires --i-approve-1b)
 *
 * PERMANENTLY BLOCKED, regardless of flags — see FORBIDDEN below.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { assertDeletable } from "./run-ledger.mjs";

// ---------------------------------------------------------------- forbidden
/**
 * Operations this script will never perform. Checked at the request layer, so
 * a coding mistake in a phase cannot reach Adobe.
 */
const FORBIDDEN = [
  { test: (r) => JSON.stringify(r.body ?? {}).includes('"ALL"'), why: 'datasetId "ALL" is permanently forbidden' },
  { test: (r) => r.path?.startsWith("/data/core/hygiene/workorder") && r.method !== "GET", why: "record deletion is out of scope" },
  { test: (r) => r.path?.startsWith("/data/core/hygiene/ttl") && r.method !== "GET", why: "dataset expiration creation is out of scope" },
  { test: (r) => r.path?.startsWith("/data/foundation/import/") && r.method !== "GET", why: "batch ingestion is out of scope" },
  { test: (r) => r.path?.startsWith("/data/core/privacy/") && r.method !== "GET", why: "all Privacy mutations are out of scope" },
  { test: (r) => r.path?.includes("/edge/datastreams") && r.method !== "GET", why: "all datastream mutations are out of scope" },
  { test: (r) => r.path?.startsWith("/data/core/ups/access/entities") && r.method !== "GET", why: "profile deletion is out of scope" },
  { test: (r) => r.path?.includes("/schemaregistry/") && r.method !== "GET", why: "schema creation/modification is out of scope" },
];

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const has = (n) => args.includes(n);

const envFile = opt("--env");
const phase = opt("--phase");
if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const RUN_ID = process.env.PHASE_RUN_ID ?? randomUUID();
const LEDGER_DIR = "docs/run-ledgers";
const LEDGER = `${LEDGER_DIR}/run-${RUN_ID}.json`;
const PREFIX = `mcpval-2026-08-14-${RUN_ID}`;

mkdirSync(LEDGER_DIR, { recursive: true });

const ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, "utf8"))
  : { runId: RUN_ID, prefix: PREFIX, sandbox: process.env.AEP_SANDBOX_NAME, baseline: null, created: [], events: [] };

const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
const note = (event, detail) => { ledger.events.push({ event, detail }); save(); };

// ------------------------------------------------------------------ client
const { loadCredentials } = await import("../dist/auth/credentials.js");
const { AepClient } = await import("../dist/auth/aep-client.js");
const { TokenCache } = await import("../dist/auth/token-cache.js");

const creds = loadCredentials();
if (creds.sandboxName !== "focusgts-ucp") {
  console.error(`REFUSING: sandbox is '${creds.sandboxName}', expected 'focusgts-ucp'`);
  process.exit(2);
}

const realClient = new AepClient(creds, new TokenCache(creds));

// Resolve the sandbox type exactly as server.ts does at bootstrap. Without
// this the client has no sandbox info, the write guard treats the type as
// unknown, and fails closed on every mutation — which is correct behaviour,
// and is what the first canary attempt correctly hit.
const { resolveSandbox } = await import("../dist/auth/sandbox-guard.js");
const sandboxInfo = await resolveSandbox(realClient, creds);
realClient.setSandboxInfo(sandboxInfo);
console.log(`sandbox resolved: type=${sandboxInfo.type} state=${sandboxInfo.state ?? "-"} source=${sandboxInfo.source}`);
if (sandboxInfo.type !== "development") {
  console.error(`REFUSING: sandbox type is '${sandboxInfo.type}', not 'development'.`);
  process.exit(2);
}


/** Counts every call and enforces FORBIDDEN before anything leaves the process. */
const calls = [];
const client = {
  request: async (spec) => {
    for (const f of FORBIDDEN) {
      if (f.test(spec)) {
        throw new Error(`BLOCKED by phase-runner: ${f.why} (${spec.method} ${spec.path})`);
      }
    }
    calls.push({ method: spec.method ?? "GET", path: spec.path });
    return realClient.request(spec);
  },
};
for (const m of ["get", "post", "put", "patch", "delete"]) {
  client[m] = (path, body) => client.request({ method: m.toUpperCase(), path, body });
}

const redact = (spec) => ({ method: spec.method, path: spec.path, body: spec.body });

// ------------------------------------------------------------------ phases
console.log(`run id : ${RUN_ID}`);
console.log(`prefix : ${PREFIX}`);
console.log(`ledger : ${LEDGER}`);
console.log(`sandbox: ${creds.sandboxName}\n`);

/**
 * Full dataset inventory, paginated.
 *
 * Catalog caps `limit` at 100 (verified: a limit of 200 returns
 * 400 "Please supply a valid query limit: (1 - 100)"). Paginating rather than
 * requesting one big page matters here — a silently truncated baseline would
 * make the post-cleanup check pass while missing datasets it never recorded.
 */
async function listDatasets() {
  const PAGE = 100;
  const out = [];
  for (let start = 0; ; start += PAGE) {
    const r = await client.request({
      method: "GET",
      path: "/data/foundation/catalog/dataSets",
      query: { limit: PAGE, start },
    });
    // Catalog returns an object keyed by dataset id.
    const page = Object.entries(r ?? {}).map(([id, v]) => ({ id, name: v?.name ?? "(unnamed)" }));
    out.push(...page);
    if (page.length < PAGE) break;
    if (start > 10_000) throw new Error("pagination guard tripped");
  }
  return out;
}

if (phase === "0") {
  console.log("PHASE 0 — baseline inventory (read-only)\n");
  const ds = await listDatasets();
  ledger.baseline = { capturedAt: null, count: ds.length, ids: ds.map((d) => d.id) };
  note("phase0.baseline", { count: ds.length });
  console.log(`  GET /data/foundation/catalog/dataSets -> 200, ${ds.length} datasets`);
  console.log(`  baseline ids recorded: ${ds.length}`);
  const ours = ds.filter((d) => d.name.startsWith("mcpval-"));
  console.log(`  pre-existing mcpval-* objects: ${ours.length}${ours.length ? " <-- INVESTIGATE" : ""}`);
  save();
}

if (phase === "1a") {
  console.log("PHASE 1a — dataset-expiration dry run (must send ZERO requests)\n");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { z } = await import("zod");
  const reg = new Map();
  registerAllTools(
    { registerTool: (n, meta, h) => reg.set(n, { meta, h }), tool: (n, d, s, h) => reg.set(n, { meta: { inputSchema: s }, h }) },
    { client, tokenCache: new TokenCache(creds), credentials: creds },
  );
  const before = calls.length;
  const { meta, h } = reg.get("aep_create_dataset_expiration");
  const parsed = z.object(meta.inputSchema).parse({
    datasetId: "PLACEHOLDER-NOT-A-REAL-DATASET",
    expiry: "2030-01-01T00:00:00Z",
    dryRun: true,
  });
  const out = JSON.parse((await h(parsed, {})).content[0].text);
  const after = calls.length;

  console.log(`  network calls before : ${before}`);
  console.log(`  network calls after  : ${after}`);
  console.log(`  DELTA                : ${after - before}  ${after === before ? "<-- ZERO, as required" : "<-- FAILED"}`);
  console.log(`  sent                 : ${out.sent}`);
  console.log(`\n  would send (redacted):`);
  console.log("   ", JSON.stringify(redact(out.wouldSend), null, 2).split("\n").join("\n    "));
  note("phase1a.dryRun", { networkCalls: after - before, sent: out.sent, wouldSend: out.wouldSend });
  if (after !== before) { console.error("\nFAIL: dry run made a network call"); process.exit(1); }
}

// --------------------------------------------------------------- helpers
/** Enable mutations for exactly one awaited operation, then unset. */
async function withMutations(label, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "AEP_ALLOW_MUTATIONS");
  const prev = process.env.AEP_ALLOW_MUTATIONS;
  process.env.AEP_ALLOW_MUTATIONS = "true";
  console.log(`  [mutations ENABLED for: ${label}]`);
  try {
    return await fn();
  } finally {
    if (had) process.env.AEP_ALLOW_MUTATIONS = prev;
    else delete process.env.AEP_ALLOW_MUTATIONS;
    console.log(`  [mutations DISABLED — AEP_ALLOW_MUTATIONS=${process.env.AEP_ALLOW_MUTATIONS ?? "(unset)"}]`);
  }
}

const statusOf = (e) => e?.status ?? e?.cause?.status ?? null;

/** GET a dataset; returns null on 404 rather than throwing. */
async function getDataset(id) {
  try {
    const r = await client.request({
      method: "GET",
      path: `/data/foundation/catalog/dataSets/${encodeURIComponent(id)}`,
    });
    const entry = Object.entries(r ?? {}).find(([k]) => k === id)?.[1];
    return entry ?? null;
  } catch (e) {
    if (statusOf(e) === 404) return null;
    throw e;
  }
}

if (phase === "canary") {
  // DELETE-ROUTE CANARY.
  //
  // Confined to this runner deliberately. It proves the DELETE route behaves
  // as documented against an id that CANNOT exist, before we create anything
  // real. It does not touch, weaken, or bypass the public tool's ledger
  // protection — it does not go through the tool at all.
  console.log("CANARY — probing the DELETE route with a non-existent id\n");

  const canaryId = [...crypto.getRandomValues(new Uint8Array(12))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  console.log(`  canary id: ${canaryId} (${canaryId.length} hex chars)`);

  const baseline = await listDatasets();
  if (baseline.some((d) => d.id === canaryId)) {
    console.error("  ABORT: canary id collides with an existing dataset");
    process.exit(1);
  }
  console.log(`  absent from baseline of ${baseline.length}: yes`);

  if ((await getDataset(canaryId)) !== null) {
    console.error("  ABORT: canary id unexpectedly EXISTS");
    process.exit(1);
  }
  console.log("  GET before -> 404 (not found), as required");

  // EXPECTED NO-MATCH RESULT — corrected from live evidence 2026-08-14.
  //
  // The approved plan predicted "HTTP 200 with an empty array". Adobe actually
  // answers a DELETE for a missing dataset with:
  //   404 {"title":"NotFoundError","detail":"DataSet not found."}
  // JSON, not HTML — so the route exists and is behaving correctly. A precise
  // 404 is arguably safer than a silent 200, since it cannot be mistaken for
  // a successful deletion.
  //
  // Both are accepted as a passing canary; which one occurred is recorded.
  let result = null;
  let status = 200;
  let notFound = false;
  try {
    result = await withMutations("canary DELETE", () =>
      client.request({
        method: "DELETE",
        path: `/data/foundation/catalog/dataSets/${encodeURIComponent(canaryId)}`,
      }),
    );
  } catch (e) {
    status = statusOf(e);
    const detail = String(e?.body?.detail ?? e?.cause?.body?.detail ?? "");
    notFound = status === 404;
    if (!notFound) {
      console.error(`  DELETE -> HTTP ${status ?? "?"} ${e.message}`);
      console.error("  ABORT: canary returned neither 200-empty nor a 404 no-match.");
      note("canary.failed", { status });
      process.exit(1);
    }
    console.log(`  DELETE -> HTTP 404 "DataSet not found." (JSON — route exists)`);
  }

  const isEmptyArray = Array.isArray(result) && result.length === 0;
  if (!notFound) {
    console.log(`  DELETE -> HTTP 200, body: ${JSON.stringify(result)}`);
    console.log(`  empty array: ${isEmptyArray ? "yes" : "NO"}`);
  }

  if ((await getDataset(canaryId)) !== null) {
    console.error("  ABORT: canary id EXISTS after the DELETE");
    process.exit(1);
  }
  console.log("  GET after  -> 404, as required");

  note("canary", { canaryId, status, notFound, emptyArray: isEmptyArray });
  if (!notFound && !isEmptyArray) {
    console.error("\n  STOP: DELETE returned 200 but not an empty array. Do not create a dataset.");
    process.exit(1);
  }
  console.log(
    `\n  CANARY PASSED — the DELETE route exists and rejects a missing id cleanly` +
      (notFound ? " (404 NotFoundError)." : " (200 empty array)."),
  );
  console.log("  NOTE: this proves the MISSING-id path only. The SUCCESS response");
  console.log("        shape remains unverified — see the report.");
}

if (phase === "1b") {
  console.error(
    "PHASE 1b — run via --phase 1b-run after the canary passes in the same run id.",
  );
  process.exit(3);
}

console.log(`\nledger written: ${LEDGER}`);
