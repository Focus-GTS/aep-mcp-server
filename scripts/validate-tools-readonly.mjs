#!/usr/bin/env node
/**
 * Tool-level read-only validation.
 *
 * scripts/validate-readonly.mjs probes nine raw HTTP paths. Useful, but it
 * tells you the API is reachable, not that OUR TOOL works — the two diverged
 * once already, when a probe tested `/data/foundation/edge/datastreams` while
 * every tool used `/data/core/edge/datastreams`. The probe failed, the tools
 * were blamed, and it took a live re-probe months later to find that the
 * validator had been testing a path no tool called.
 *
 * This runner exercises the REGISTERED TOOL HANDLERS instead. What it reports
 * is what a real agent would get.
 *
 * SAFETY — this cannot mutate anything:
 *   1. It only invokes tools whose annotations say `readOnlyHint: true`.
 *   2. Any tool without that annotation is skipped and counted, never called.
 *   3. AEP_ALLOW_MUTATIONS is force-deleted from the environment before the
 *      client is built, so even a mis-annotated tool is refused by the write
 *      guard rather than reaching Adobe.
 *
 *   node scripts/validate-tools-readonly.mjs --env .env [--json out.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const envFile = opt("--env");
const jsonOut = opt("--json");

if (envFile) {
  if (!existsSync(envFile)) { console.error(`env file not found: ${envFile}`); process.exit(2); }
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Belt and braces: no mutation may be enabled for this process, whatever the
// .env says. Deleted before the client reads it.
delete process.env.AEP_ALLOW_MUTATIONS;
process.env.AEP_MODE = "read-only";

const fp = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);
const EXPECTED_ORG = process.env.AEP_EXPECTED_ORG_ID;
const EXPECTED_SBX = process.env.AEP_EXPECTED_SANDBOX_NAME;
if (!EXPECTED_ORG || !EXPECTED_SBX) {
  console.error("REFUSING: set AEP_EXPECTED_ORG_ID and AEP_EXPECTED_SANDBOX_NAME (wrong-org guard).");
  process.exit(2);
}

const { loadCredentials } = await import("../dist/auth/credentials.js");
const { AepClient } = await import("../dist/auth/aep-client.js");
const { TokenCache } = await import("../dist/auth/token-cache.js");
const { resolveSandbox } = await import("../dist/auth/sandbox-guard.js");
const { registerAllTools } = await import("../dist/tools/index.js");

const creds = loadCredentials();
if (creds.orgId !== EXPECTED_ORG || creds.sandboxName !== EXPECTED_SBX) {
  console.error(`REFUSING: tenant mismatch (org sha256:${fp(creds.orgId)}, sandbox sha256:${fp(creds.sandboxName)})`);
  process.exit(2);
}

const client = new AepClient(creds, new TokenCache(creds));
const info = await resolveSandbox(client, creds);
client.setSandboxInfo(info);
console.error(`Sandbox '${creds.sandboxName}' type=${info.type} state=${info.state}\n`);

// ---------------------------------------------------------------- registry
const tools = new Map();
registerAllTools(
  { registerTool: (n, cfg, h) => tools.set(n, { cfg, handler: h }),
    tool: (n, _d, _s, h) => tools.set(n, { cfg: {}, handler: h }) },
  { client, tokenCache: new TokenCache(creds), credentials: creds },
);

const readOnly = [...tools.entries()].filter(([, t]) => t.cfg?.annotations?.readOnlyHint === true);
const skipped  = [...tools.entries()].filter(([, t]) => t.cfg?.annotations?.readOnlyHint !== true);

// ------------------------------------------------- args, chained from reads
// Tools needing an id get one discovered from a list call. A tool whose id
// cannot be discovered is reported NO_FIXTURE, never guessed — a fabricated id
// produces a 404 that looks like a broken tool.
const discovered = {};
async function call(name, a = {}) {
  const t = tools.get(name);
  if (!t) return { status: "MISSING", detail: "not registered" };
  try {
    // Parse through the tool's OWN schema before invoking, exactly as the MCP
    // server does. Calling a handler directly skips Zod entirely, so `.default()`
    // never fires and required params are never enforced — which produced three
    // convincing false failures on the first run of this script:
    // list_schemas 400 (containerType defaults to "tenant"), list_privacy_jobs
    // 400 (regulation is required), and a raw TypeError from
    // get_dataset_expiration (its param is `id`, not `datasetId`).
    // A validator that reports bugs the product does not have is worse than no
    // validator, so the parse is not optional here.
    let parsed = a;
    if (t.cfg?.inputSchema) {
      const r = z.object(t.cfg.inputSchema).safeParse(a);
      if (!r.success) {
        return { status: "BAD_ARGS", detail: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 90) };
      }
      parsed = r.data;
    }
    const res = await t.handler(parsed, {});
    const text = res?.content?.[0]?.text ?? "";
    let payload = null; try { payload = JSON.parse(text); } catch { /* non-JSON */ }
    if (res?.isError) return { status: "ERROR", detail: payload?.code ?? text.slice(0, 80), payload };
    return { status: "OK", payload };
  } catch (e) { return { status: "THREW", detail: String(e?.message ?? e).slice(0, 100) }; }
}

const firstId = (p, ...keys) => {
  for (const k of keys) {
    const v = p?.[k];
    if (Array.isArray(v) && v.length) return v[0]?.id ?? v[0]?.[Object.keys(v[0])[0]];
  }
  if (p && typeof p === "object") {
    const ks = Object.keys(p);
    if (ks.length && typeof p[ks[0]] === "object") return ks[0];
  }
  return undefined;
};

console.error("Discovering ids from list calls…");
const dsList = await call("aep_list_datasets", { limit: 3 });
discovered.datasetId = firstId(dsList.payload, "datasets", "results", "items");
const scList = await call("aep_list_schemas", { limit: 3 });
discovered.schemaId = scList.payload?.schemas?.[0]?.$id ?? scList.payload?.results?.[0]?.$id;
const ttlList = await call("aep_list_dataset_expirations", {});
discovered.ttlId = ttlList.payload?.expirations?.[0]?.ttlId ?? ttlList.payload?.results?.[0]?.ttlId;
const bList = await call("aep_list_batches", { limit: 3 });
discovered.batchId = firstId(bList.payload, "batches", "results", "items");
for (const [k, v] of Object.entries(discovered)) console.error(`  ${k}: ${v ? "found" : "none in sandbox"}`);
console.error("");

const ARGS = {
  aep_get_dataset:            () => discovered.datasetId && { datasetId: discovered.datasetId },
  aep_get_schema:             () => discovered.schemaId && { schemaId: discovered.schemaId },
  aep_get_batch_status:       () => discovered.batchId && { batchId: discovered.batchId },
  aep_get_dataset_expiration: () => discovered.ttlId && { id: discovered.ttlId },
  aep_list_datasets:          () => ({ limit: 3 }),
  aep_list_schemas:           () => ({ limit: 3 }),
  aep_list_batches:           () => ({ limit: 3 }),
  aep_list_segments:          () => ({ limit: 3 }),
  aep_estimate_segment_size:  () => null,   // needs a PQL definition; not a read fixture
  aep_get_segment:            () => null,
  aep_get_profile:            () => null,   // needs a real profile id
  aep_get_profile_by_identity:() => null,
  aep_preview_profile:        () => null,
  aep_get_identity_graph:     () => null,
  aep_list_privacy_jobs:      () => ({ regulation: "gdpr", limit: 3 }),
  aep_get_privacy_job:        () => null,
  aep_get_privacy_job_results:() => null,
  aep_get_work_order_status:  () => null,
  aep_get_query_status:       () => null,
};

// ------------------------------------------------------------------- run
const results = [];
for (const [name] of readOnly) {
  const build = ARGS[name];
  const a = build ? build() : {};
  if (a === null || a === undefined) {
    results.push({ tool: name, status: "NO_FIXTURE", detail: "needs an id/param this sandbox cannot supply read-only" });
    continue;
  }
  const r = await call(name, a);
  results.push({ tool: name, ...r, payload: undefined });
}

// ------------------------------------------------------------------ report
const pad = (s, n) => String(s).padEnd(n);
const ICON = { OK: "PASS", ERROR: "FAIL", THREW: "THREW", NO_FIXTURE: "skip", MISSING: "MISS", BAD_ARGS: "ARGS" };
console.log("tool                                 result  detail");
console.log("-".repeat(96));
for (const r of results.sort((a, b) => a.tool.localeCompare(b.tool))) {
  console.log(`${pad(r.tool, 36)} ${pad(ICON[r.status] ?? r.status, 7)} ${r.detail ?? ""}`);
}
const n = (s) => results.filter((r) => r.status === s).length;
console.log("");
console.log(`read-only tools: ${readOnly.length}   PASS ${n("OK")}   FAIL ${n("ERROR") + n("THREW")}   bad-args ${n("BAD_ARGS")}   no-fixture ${n("NO_FIXTURE")}`);
console.log(`not invoked (not annotated read-only): ${skipped.length}`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ results, skipped: skipped.map(([n]) => n) }, null, 2)); console.log(`\nwrote ${jsonOut}`); }
process.exit(n("ERROR") + n("THREW") > 0 ? 1 : 0);
