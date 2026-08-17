#!/usr/bin/env node
/**
 * Phased live-mutation runner for a single development sandbox,
 * named by AEP_EXPECTED_SANDBOX_NAME.
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
import { createHash, randomUUID } from "node:crypto";
import { assertDeletable, assertBatchOwned } from "./run-ledger.mjs";

// ---------------------------------------------------------------- forbidden
/**
 * Operations this script will never perform. Checked at the request layer, so
 * a coding mistake in a phase cannot reach Adobe.
 */
/**
 * What each phase is allowed to do, derived from the phase itself.
 *
 * This replaces a hand-maintained FORBIDDEN list. That list blocked the
 * approved operation at the start of Phase 2A, again at 2B, and again at 2C —
 * three times, because widening it was a separate step I had to remember and
 * did not. A static denylist that must be edited for every new phase will keep
 * failing that way.
 *
 * Now the phase declares its own permitted mutations, and everything not
 * listed is refused. Adding a phase means describing what it may do, which is
 * the thing you cannot forget, rather than remembering to unblock it.
 */
const PHASE_PERMITS = {
  "0":      [],
  "1a":     [],
  canary:   ["dataset.delete"],
  "1b":     ["dataset.create", "dataset.delete"],
  "2a":     ["dataset.create", "dataset.delete", "batch.create", "batch.abort", "batch.revert"],
  "2b":     ["dataset.create", "dataset.delete", "batch.create", "batch.abort", "batch.upload"],
  "2c":     ["dataset.create", "dataset.delete", "batch.create", "batch.abort", "batch.upload",
             "batch.complete", "batch.revert"],
  // Phase 3A: expiration lifecycle only. No batches, no records, and
  // crucially no record-delete work orders — ttl.* is not workorder.*.
  "3a":     ["dataset.create", "dataset.delete", "ttl.create", "ttl.update", "ttl.cancel"],
};

/** Classify a request into one of the capability names above. */
function classifyMutation(r) {
  const m = (r.method ?? "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null; // reads always allowed
  const p = r.path ?? "";
  const action = String(r.query?.action ?? "").toUpperCase();

  if (p.startsWith("/data/foundation/catalog/dataSets")) {
    if (m === "DELETE") return "dataset.delete";
    if (m === "POST") return "dataset.create";
  }
  if (p === "/data/core/hygiene/ttl" && m === "POST") return "ttl.create";
  if (p.startsWith("/data/core/hygiene/ttl/")) {
    if (m === "PUT") return "ttl.update";
    if (m === "DELETE") return "ttl.cancel";
  }
  if (p === "/data/foundation/import/batches" && m === "POST") return "batch.create";
  if (p.startsWith("/data/foundation/import/batches/")) {
    if (m === "PUT" && /\/datasets\/[^/]+\/files\/[^/]+$/.test(p)) return "batch.upload";
    if (m === "POST" && action === "ABORT") return "batch.abort";
    if (m === "POST" && action === "REVERT") return "batch.revert";
    if (m === "POST" && action === "COMPLETE") return "batch.complete";
  }
  // Anything else that mutates is unclassified, and therefore refused.
  return `unclassified:${m} ${p}${action ? "?action=" + action : ""}`;
}

/** Hard prohibitions that no phase may ever permit. */
const NEVER = [
  { test: (r) => JSON.stringify(r.body ?? {}).includes('"ALL"'), why: 'datasetId "ALL" is permanently forbidden' },
  // Record-delete work orders stay permanently forbidden. Expiration (ttl)
  // mutations are gated per phase instead — they are cancellable and scheduled,
  // whereas a work order destroys data on a 30-day SLA with no way back.
  { test: (r) => r.path?.startsWith("/data/core/hygiene/workorder") && r.method !== "GET", why: "record-delete work orders are permanently out of scope" },
  { test: (r) => r.path?.startsWith("/data/core/privacy/") && r.method !== "GET", why: "Privacy mutations are out of scope" },
  { test: (r) => r.path?.includes("/edge/datastreams") && r.method !== "GET", why: "no datastream tools exist since 0.9.0; this stays as a backstop" },
  { test: (r) => r.path?.startsWith("/data/core/ups/access/entities") && r.method !== "GET", why: "profile deletion is out of scope" },
  { test: (r) => r.path?.includes("/schemaregistry/") && r.method !== "GET", why: "schema mutations are out of scope" },
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
// ONE source for the run prefix. Phase 2A previously hardcoded its own date
// (08-15) while this constant said 08-14, so the ledger recorded a prefix that
// no created object actually carried — and the ownership guard correctly
// refused to clean up. A duplicated literal is a divergence waiting to happen.
const RUN_DATE = process.env.PHASE_RUN_DATE ?? "2026-08-16";
const PREFIX = `mcpval-${RUN_DATE}-${RUN_ID}`;

mkdirSync(LEDGER_DIR, { recursive: true });

const ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, "utf8"))
  : { runId: RUN_ID, prefix: PREFIX, sandbox: process.env.AEP_SANDBOX_NAME, baseline: null, created: [], batches: [], events: [] };

const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
const note = (event, detail) => { ledger.events.push({ event, detail }); save(); };

// ------------------------------------------------------------------ client
const { loadCredentials } = await import("../dist/auth/credentials.js");
const { AepClient } = await import("../dist/auth/aep-client.js");
const { TokenCache } = await import("../dist/auth/token-cache.js");

const creds = loadCredentials();
// Wrong-sandbox guard, parameterised 2026-08-16. The expected name used to be
// hardcoded, which pinned this runner to one tenant and published that
// tenant's sandbox name in a public repo. It fails closed: an unset
// expectation is fatal, because "nobody told me which sandbox" must never be
// read as "any sandbox will do".
const EXPECTED_SANDBOX = process.env.AEP_EXPECTED_SANDBOX_NAME;
if (!EXPECTED_SANDBOX) {
  console.error(
    "REFUSING: AEP_EXPECTED_SANDBOX_NAME is not set.\n" +
      "This runner performs live mutations and will not start until it has been told\n" +
      "which sandbox it is supposed to be mutating. Set it in your untracked .env:\n" +
      "  AEP_EXPECTED_SANDBOX_NAME=<DEVELOPMENT_SANDBOX>",
  );
  process.exit(2);
}
if (creds.sandboxName !== EXPECTED_SANDBOX) {
  const fp = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);
  console.error(
    `REFUSING: sandbox mismatch (actual sha256:${fp(creds.sandboxName)}, ` +
      `expected sha256:${fp(EXPECTED_SANDBOX)})`,
  );
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
    for (const f of NEVER) {
      if (f.test(spec)) {
        throw new Error(`BLOCKED by phase-runner: ${f.why} (${spec.method} ${spec.path})`);
      }
    }
    const cap = classifyMutation(spec);
    if (cap !== null) {
      const permitted = PHASE_PERMITS[phase] ?? [];
      if (!permitted.includes(cap)) {
        throw new Error(
          `BLOCKED by phase-runner: phase '${phase}' does not permit '${cap}'. ` +
          `Permitted: [${permitted.join(", ") || "none"}]`,
        );
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
  console.log("PHASE 1b — create one disposable dataset, then delete it\n");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { z } = await import("zod");
  const { assertDeletable: check } = await import("./run-ledger.mjs");

  const reg = new Map();
  registerAllTools(
    { registerTool: (n, meta, h) => reg.set(n, { meta, h }), tool: (n, d, sc, h) => reg.set(n, { meta: { inputSchema: sc }, h }) },
    { client, tokenCache: new TokenCache(creds), credentials: creds },
  );
  const tool = async (name, a) => {
    const { meta, h } = reg.get(name);
    return JSON.parse((await h(z.object(meta.inputSchema ?? {}).parse(a), {})).content[0].text);
  };

  // 1. Refresh the baseline — a shared sandbox can drift between runs.
  const baseline = await listDatasets();
  ledger.baseline = { count: baseline.length, ids: baseline.map((d) => d.id) };
  save();
  console.log(`  1. baseline refreshed: ${baseline.length} datasets`);

  // 2/3. Choose a safe read-only schema and log it.
  const schemas = await client.request({
    method: "GET",
    path: "/data/foundation/schemaregistry/tenant/schemas",
    query: { limit: 100 },
    headers: { Accept: "application/vnd.adobe.xed-id+json" },
  });
  const candidates = (schemas.results ?? []).filter((x) => {
    const t = String(x.title ?? "");
    return x.$id && !t.startsWith("_") && !/adobe|system|internal/i.test(t);
  });
  if (candidates.length === 0) {
    console.error("  STOP: no schema could be confidently selected. Not creating a dataset.");
    process.exit(1);
  }
  const schema = candidates[0];
  console.log(`  2. schema selected (READ-ONLY, unmodified):`);
  console.log(`       title: ${schema.title}`);
  console.log(`       $id  : ${schema.$id}`);
  note("phase1b.schema", { id: schema.$id, title: schema.title });

  // 4/5. Create exactly one dataset, Profile disabled.
  const name = `${PREFIX}-phase1`;
  const created = await withMutations("create dataset", () =>
    tool("aep_create_dataset", { name, schemaRef: schema.$id, enabledForProfile: false }),
  );
  const newId = created.datasetId ?? created.id;
  if (!newId) {
    console.error("  STOP: create returned no dataset id:", JSON.stringify(created).slice(0, 200));
    process.exit(1);
  }
  ledger.created.push({ id: newId, name, phase: "1b" });
  save();
  console.log(`  4. created: ${newId}`);
  console.log(`     name   : ${name}`);

  // 6. Verify it exists and looks right.
  const got = await getDataset(newId);
  if (!got) { console.error("  STOP: created dataset not readable"); process.exit(1); }
  console.log(`  6. verified: name='${got.name}' profileEnabled=${JSON.stringify(got.tags?.unifiedProfile ?? null)}`);

  // 7. dryRun.
  const dry = await tool("aep_delete_dataset", { datasetId: newId, dryRun: true });
  console.log(`  7. dryRun sent=${dry.sent} (must be false)`);
  if (dry.sent !== false) { console.error("  STOP: dryRun sent a request"); process.exit(1); }

  // 8. Ledger ownership check.
  check(ledger, newId);
  console.log("  8. assertDeletable passed");

  // 9/10/11/12. Real delete inside a narrow mutation window.
  const del = await withMutations("delete dataset", () =>
    tool("aep_delete_dataset", {
      datasetId: newId,
      dryRun: false,
      confirm: `DELETE DATASET ${newId}`,
    }),
  );
  console.log(`  10. delete outcome        : ${del.deleteOutcome ?? del.code}`);
  console.log(`      matchedDocumentation  : ${del.deleteResponseMatchedDocumentation}`);
  console.log(`      responseContractMismatch: ${del.responseContractMismatch ?? "none"}`);
  console.log(`      postDeleteGetStatus   : ${del.postDeleteGetStatus}`);
  console.log(`      cleanupConfirmed      : ${del.cleanupConfirmed}`);
  console.log(`      retryPerformed        : ${del.retryPerformed}`);
  note("phase1b.delete", del);

  // 13. Authoritative check.
  const after = await getDataset(newId);
  console.log(`  13. GET after delete: ${after === null ? "404 — gone" : "STILL EXISTS"}`);

  // 14. Baseline comparison.
  const final = await listDatasets();
  const finalIds = new Set(final.map((d) => d.id));
  const missing = ledger.baseline.ids.filter((b) => !finalIds.has(b));
  const ours = final.filter((d) => String(d.name).startsWith(PREFIX));
  const added = final.filter((d) => !ledger.baseline.ids.includes(d.id) && !String(d.name).startsWith(PREFIX));

  console.log(`  14. baseline ids still present: ${ledger.baseline.ids.length - missing.length}/${ledger.baseline.ids.length}`);
  console.log(`      objects with this run prefix remaining: ${ours.length}`);
  console.log(`      unrelated concurrent additions (untouched): ${added.length}`);

  const clean = after === null && missing.length === 0 && ours.length === 0;
  note("phase1b.result", { cleanupConfirmed: del.cleanupConfirmed, orphan: after !== null, missingBaseline: missing.length });
  if (!clean) {
    console.error(`\n  ORPHAN / BASELINE PROBLEM — id ${newId} name ${name}`);
    process.exit(1);
  }
  console.log("\n  PHASE 1b COMPLETE — created and fully cleaned up.");
}

if (phase === "2a") {
  console.log("PHASE 2A — empty batch lifecycle. No upload, no COMPLETE, no records.\n");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { z } = await import("zod");

  const reg = new Map();
  registerAllTools(
    { registerTool: (n, meta, h) => reg.set(n, { meta, h }), tool: (n, d, sc, h) => reg.set(n, { meta: { inputSchema: sc }, h }) },
    { client, tokenCache: new TokenCache(creds), credentials: creds },
  );
  const tool = async (name, a) => {
    const { meta, h } = reg.get(name);
    return JSON.parse((await h(z.object(meta.inputSchema ?? {}).parse(a), {})).content[0].text);
  };
  const P2 = `${PREFIX}-phase2a`;

  // 1. Baseline.
  const baseline = await listDatasets();
  ledger.baseline = { count: baseline.length, ids: baseline.map((d) => d.id) };
  save();
  console.log(`  1. baseline: ${baseline.length} datasets`);

  // Previously validated read-only schema.
  const schemas = await client.request({
    method: "GET", path: "/data/foundation/schemaregistry/tenant/schemas",
    query: { limit: 100 }, headers: { Accept: "application/vnd.adobe.xed-id+json" },
  });
  const schema = (schemas.results ?? []).find((x) => x.title === "AJO Channel Tracking Event Schema");
  if (!schema) { console.error("  STOP: previously validated schema not found"); process.exit(1); }
  console.log(`  2. schema (read-only): ${schema.title}`);

  // 1. Create the isolated dataset.
  const created = await withMutations("create dataset", () =>
    tool("aep_create_dataset", { name: P2, schemaRef: schema.$id, enabledForProfile: false }),
  );
  const dsId = created.datasetId ?? created.id;
  if (!dsId) { console.error("  STOP: no dataset id returned"); process.exit(1); }
  ledger.created.push({ id: dsId, name: P2, phase: "1b" }); // phase key reused by assertDeletable
  save();
  console.log(`  3. dataset created: ${dsId}`);

  // 2. Verify it, and that it has zero batches.
  const ds = await getDataset(dsId);
  const existingBatches = await tool("aep_list_batches", { limit: 10, datasetId: dsId }).catch(() => null);
  console.log(`  4. verified name='${ds?.name}' profileTag=${JSON.stringify(ds?.tags?.unifiedProfile ?? null)}`);
  console.log(`     batches on it: ${existingBatches?.count ?? "n/a"}`);

  // 3/4. Create ONE json batch on that dataset only.
  const batch = await withMutations("create batch", () =>
    tool("aep_create_batch", { datasetId: dsId, format: "json" }),
  );
  const batchId = batch.id ?? batch.batchId;
  if (!batchId) { console.error("  STOP: no batch id returned:", JSON.stringify(batch).slice(0,200)); process.exit(1); }
  ledger.batches.push({ id: batchId, datasetId: dsId, phase: "2a" });
  save();
  console.log(`  5. batch created: ${batchId}  status=${batch.status ?? "?"}`);

  // 5/6. Read it back.
  const st1 = await tool("aep_get_batch_status", { batchId });
  console.log(`  6. get status: ${st1.status ?? JSON.stringify(st1).slice(0,80)}`);

  // Ownership gate before any action.
  assertBatchOwned(ledger, batchId);

  // 7/8. ABORT.
  const dryAbort = await tool("aep_abort_batch", { batchId, dryRun: true });
  console.log(`  7. abort dryRun sent=${dryAbort.sent}`);
  const aborted = await withMutations("ABORT batch", () =>
    tool("aep_abort_batch", { batchId, dryRun: false }),
  );
  console.log(`     abort: ${aborted.aborted ? "ok" : JSON.stringify(aborted).slice(0,140)}`);
  const st2 = await tool("aep_get_batch_status", { batchId });
  console.log(`  8. status after abort: ${st2.status ?? "?"}`);

  // 9. REVERT.
  const reverted = await withMutations("REVERT batch", () =>
    tool("aep_revert_batch", { batchId, dryRun: false, confirm: `REVERT BATCH ${batchId}` }),
  );
  console.log(`  9. revert: ${reverted.reverted ? "ok" : JSON.stringify(reverted).slice(0,140)}`);

  // 10. Poll read-only until inactive/deleted/not-found.
  let finalStatus = null;
  for (const wait of [0, 1000, 3000, 5000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const s = await tool("aep_get_batch_status", { batchId });
      finalStatus = s.status ?? null;
      if (["inactive", "deleted"].includes(String(finalStatus).toLowerCase())) break;
    } catch { finalStatus = "not-found"; break; }
  }
  console.log(` 10. final batch status: ${finalStatus}`);
  note("phase2a.batch", { batchId, finalStatus });
  const batchClean = ["inactive", "deleted", "not-found"].includes(String(finalStatus).toLowerCase());
  if (!batchClean) {
    console.error(`\n  STOP: batch cleanup unconfirmed. batchId=${batchId} datasetId=${dsId}`);
    process.exit(1);
  }

  // 11/12. Delete the dataset with the validated tool.
  assertDeletable(ledger, dsId);
  const del = await withMutations("delete dataset", () =>
    tool("aep_delete_dataset", { datasetId: dsId, dryRun: false, confirm: `DELETE DATASET ${dsId}` }),
  );
  console.log(` 11. dataset delete: cleanupConfirmed=${del.cleanupConfirmed} getStatus=${del.postDeleteGetStatus}`);

  // 13. Baseline comparison.
  const final = await listDatasets();
  const ids = new Set(final.map((d) => d.id));
  const missing = ledger.baseline.ids.filter((b) => !ids.has(b));
  const ours = final.filter((d) => String(d.name).startsWith(PREFIX));
  console.log(` 13. baseline present: ${ledger.baseline.ids.length - missing.length}/${ledger.baseline.ids.length}`);
  console.log(`     objects with this run prefix remaining: ${ours.length}`);
  note("phase2a.result", { datasetId: dsId, batchId, cleanupConfirmed: del.cleanupConfirmed, missing: missing.length });

  if (!del.cleanupConfirmed || missing.length || ours.length) {
    console.error(`\n  ORPHAN — dataset ${dsId} (${P2}), batch ${batchId}`);
    process.exit(1);
  }
  console.log("\n  PHASE 2A COMPLETE — batch lifecycle validated, everything cleaned up.");
}

if (phase === "2b") {
  console.log("PHASE 2B — stage one file, then ABORT. No COMPLETE, no REVERT.\n");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { z } = await import("zod");

  const reg = new Map();
  registerAllTools(
    { registerTool: (n, meta, h) => reg.set(n, { meta, h }), tool: (n, d, sc, h) => reg.set(n, { meta: { inputSchema: sc }, h }) },
    { client, tokenCache: new TokenCache(creds), credentials: creds },
  );
  const tool = async (name, a) => {
    const { meta, h } = reg.get(name);
    return JSON.parse((await h(z.object(meta.inputSchema ?? {}).parse(a), {})).content[0].text);
  };
  const NAME = `${PREFIX}-phase2b`;
  const FILE_NAME = `${PREFIX}-phase2b.json`;
  const MAX_VALIDATION_BYTES = 1024;

  // ---- Phase-2B restrictions, enforced before any live call --------------
  const requireOwned = (kind, id) => {
    const pool = kind === "dataset" ? ledger.created : ledger.batches;
    if (!(pool ?? []).some((x) => x.id === id)) {
      throw new Error(`REFUSING: ${kind} ${id} is not in this run's ledger`);
    }
  };
  const validateFileName = (f) => {
    if (!f.startsWith(PREFIX)) throw new Error(`filename must carry the run prefix: ${f}`);
    if (!f.endsWith(".json")) throw new Error(`filename must end in .json: ${f}`);
    if (/[\\/]|\.\./.test(f)) throw new Error(`filename must not contain slashes or traversal: ${f}`);
  };
  validateFileName(FILE_NAME);

  // 2. Baseline.
  const baseline = await listDatasets();
  ledger.baseline = { count: baseline.length, ids: baseline.map((d) => d.id) };
  save();
  console.log(`  baseline: ${baseline.length} datasets`);

  // 6. Schema, read-only.
  const schemas = await client.request({
    method: "GET", path: "/data/foundation/schemaregistry/tenant/schemas",
    query: { limit: 100 }, headers: { Accept: "application/vnd.adobe.xed-id+json" },
  });
  const schema = (schemas.results ?? []).find((x) => x.title === "AJO Channel Tracking Event Schema");
  if (!schema) { console.error("  STOP: schema not found"); process.exit(1); }
  console.log(`  schema (read-only): ${schema.title}`);

  // Synthetic record. ExperienceEvent requires _id and timestamp, nothing else.
  // No name, email, phone, ECID, or any other identifier of a real person.
  const record = { _id: `${PREFIX}-rec1`, timestamp: "2026-08-16T00:00:00.000Z" };
  const jsonl = JSON.stringify(record) + "\n";
  const bytes = Buffer.byteLength(jsonl, "utf8");
  console.log(`  payload: 1 JSONL record, ${bytes} bytes`);
  console.log(`           fields: ${Object.keys(record).join(", ")} (both synthetic)`);
  if (bytes > MAX_VALIDATION_BYTES) { console.error("  STOP: payload exceeds 1 KB cap"); process.exit(1); }

  // 7/8. Isolated dataset.
  const created = await withMutations("create dataset", () =>
    tool("aep_create_dataset", { name: NAME, schemaRef: schema.$id, enabledForProfile: false }),
  );
  const dsId = created.datasetId ?? created.id;
  if (!dsId) { console.error("  STOP: no dataset id"); process.exit(1); }
  ledger.created.push({ id: dsId, name: NAME, phase: "1b" });
  save();
  console.log(`  dataset: ${dsId}`);

  // 9/10/11. Batch.
  const batch = await withMutations("create batch", () =>
    tool("aep_create_batch", { datasetId: dsId, format: "json" }),
  );
  const batchId = batch.id ?? batch.batchId;
  if (!batchId) { console.error("  STOP: no batch id"); process.exit(1); }
  ledger.batches.push({ id: batchId, datasetId: dsId, phase: "2b" });
  save();
  console.log(`  batch  : ${batchId} status=${batch.status}`);

  requireOwned("dataset", dsId);
  requireOwned("batch", batchId);

  // batch.relatedObjects must reference this exact dataset.
  const rec = await client.request({ method: "GET", path: `/data/foundation/catalog/batches/${batchId}` });
  const b = Object.values(rec ?? {})[0] ?? {};
  const related = (b.relatedObjects ?? []).filter((r) => r.type === "dataSet").map((r) => r.id);
  console.log(`  relatedObjects: ${JSON.stringify(related)}`);
  if (related.length !== 1 || related[0] !== dsId) {
    console.error("  STOP: batch is not bound to exactly our dataset"); process.exit(1);
  }
  if (String(b.status).toLowerCase() !== "loading") {
    console.error(`  STOP: batch status is '${b.status}', expected loading`); process.exit(1);
  }
  console.log(`  status before upload: ${b.status}`);

  // 12. Upload dry run.
  const dry = await tool("aep_upload_batch_file", {
    batchId, datasetId: dsId, fileName: FILE_NAME, content: jsonl, dryRun: true,
  });
  console.log(`  upload dryRun sent=${dry.sent} bytes=${dry.wouldSend?.bodyBytes} sha=${dry.wouldSend?.bodySha256Prefix}`);
  if (dry.sent !== false) { console.error("  STOP: dryRun sent a request"); process.exit(1); }

  // 13/14. Real upload.
  let uploaded = null, uploadErr = null;
  try {
    uploaded = await withMutations("upload file", () =>
      tool("aep_upload_batch_file", {
        batchId, datasetId: dsId, fileName: FILE_NAME, content: jsonl, dryRun: false,
      }),
    );
  } catch (e) { uploadErr = e; }
  const uploadOk = Boolean(uploaded?.uploaded);
  console.log(`  upload : ${uploadOk ? `ok, ${uploaded.bytesUploaded} bytes` : JSON.stringify(uploaded ?? String(uploadErr)).slice(0, 180)}`);
  note("phase2b.upload", { ok: uploadOk, bytes: uploaded?.bytesUploaded ?? null });
  // The upload IS the phase. Cleanup still runs below, but the run must not be
  // reported as complete if the thing it exists to test did not happen — an
  // earlier version printed "COMPLETE — file staged" after a blocked upload.

  // 15/16. Read the batch. COMPLETE was never called, so it must not be active.
  const rec2 = await client.request({ method: "GET", path: `/data/foundation/catalog/batches/${batchId}` });
  const b2 = Object.values(rec2 ?? {})[0] ?? {};
  console.log(`  status after upload: ${b2.status}`);
  if (["active", "success"].includes(String(b2.status).toLowerCase())) {
    console.error("  STOP: batch became active/success without COMPLETE"); process.exit(1);
  }

  // 17/18. ABORT if still in progress.
  let finalBatch = b2.status;
  if (!["aborted", "failed"].includes(String(b2.status).toLowerCase())) {
    await withMutations("ABORT batch", () => tool("aep_abort_batch", { batchId, dryRun: false }));
    const rec3 = await client.request({ method: "GET", path: `/data/foundation/catalog/batches/${batchId}` });
    finalBatch = (Object.values(rec3 ?? {})[0] ?? {}).status;
  }
  console.log(`  batch final: ${finalBatch}`);

  // 19/20. Delete the dataset.
  assertDeletable(ledger, dsId);
  const del = await withMutations("delete dataset", () =>
    tool("aep_delete_dataset", { datasetId: dsId, dryRun: false, confirm: `DELETE DATASET ${dsId}` }),
  );
  console.log(`  dataset delete: cleanupConfirmed=${del.cleanupConfirmed} getStatus=${del.postDeleteGetStatus}`);

  const final = await listDatasets();
  const ids = new Set(final.map((d) => d.id));
  const missing = ledger.baseline.ids.filter((x) => !ids.has(x));
  const ours = final.filter((d) => String(d.name).startsWith(PREFIX));
  console.log(`  baseline present: ${ledger.baseline.ids.length - missing.length}/${ledger.baseline.ids.length}`);
  console.log(`  run-prefix objects remaining: ${ours.length}`);

  ledger.outcomes = {
    dataset: { id: dsId, name: NAME, state: del.cleanupConfirmed ? "deleted" : "NOT DELETED", postDeleteGetStatus: del.postDeleteGetStatus },
    batch: { id: batchId, state: `terminal-${finalBatch}`, fileStaged: Boolean(uploaded?.uploaded), completeCalled: false, dataIngested: false,
      classification: "Terminal audit metadata. A file was staged but COMPLETE was never called, so no record entered the data lake." },
  };
  save();
  note("phase2b.result", { batchFinal: finalBatch, cleanupConfirmed: del.cleanupConfirmed });

  if (!del.cleanupConfirmed || missing.length || ours.length) {
    console.error(`\n  ORPHAN — dataset ${dsId}, batch ${batchId}`); process.exit(1);
  }
  if (!uploadOk) {
    console.error("\n  PHASE 2B FAILED — the upload did not happen. Cleanup succeeded, but the");
    console.error("  objective of this phase was not met. Do not record it as validated.");
    process.exit(1);
  }
  console.log("\n  PHASE 2B COMPLETE — file staged, batch aborted, dataset removed.");
}

if (phase === "2c") {
  console.log("PHASE 2C — one record, COMPLETE, REVERT, cleanup. First real promotion.\n");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { z } = await import("zod");
  const { writeFileSync: wf } = await import("node:fs");

  const reg = new Map();
  registerAllTools(
    { registerTool: (n, meta, h) => reg.set(n, { meta, h }), tool: (n, d, sc, h) => reg.set(n, { meta: { inputSchema: sc }, h }) },
    { client, tokenCache: new TokenCache(creds), credentials: creds },
  );
  const tool = async (name, a) => {
    const { meta, h } = reg.get(name);
    return JSON.parse((await h(z.object(meta.inputSchema ?? {}).parse(a), {})).content[0].text);
  };
  const NAME = `${PREFIX}-phase2c`;
  const FILE_NAME = `${PREFIX}-phase2c.json`;
  const readBatch = async (id) => {
    const r = await client.request({ method: "GET", path: `/data/foundation/catalog/batches/${id}` }).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));
    return r ? (Object.values(r)[0] ?? null) : null;
  };
  const fail = async (why, dsId, batchId) => {
    console.error(`\n  ${why}`);
    if (batchId) {
      const b = await readBatch(batchId);
      if (b && !["aborted", "success", "failed", "inactive", "deleted"].includes(String(b.status).toLowerCase())) {
        await withMutations("ABORT (cleanup)", () => tool("aep_abort_batch", { batchId, dryRun: false })).catch(() => {});
      }
    }
    if (dsId) {
      await withMutations("delete dataset (cleanup)", () =>
        tool("aep_delete_dataset", { datasetId: dsId, dryRun: false, confirm: `DELETE DATASET ${dsId}` }),
      ).catch((e) => console.error("   cleanup delete failed:", e?.message));
    }
    process.exit(1);
  };

  // 1. Baseline.
  const baseline = await listDatasets();
  ledger.baseline = { count: baseline.length, ids: baseline.map((d) => d.id) };
  save();
  console.log(`  baseline: ${baseline.length} datasets`);

  const schemas = await client.request({
    method: "GET", path: "/data/foundation/schemaregistry/tenant/schemas",
    query: { limit: 100 }, headers: { Accept: "application/vnd.adobe.xed-id+json" },
  });
  const schema = (schemas.results ?? []).find((x) => x.title === "AJO Channel Tracking Event Schema");
  if (!schema) { console.error("  STOP: schema not found"); process.exit(1); }
  console.log(`  schema (read-only): ${schema.title}`);

  const record = { _id: `${PREFIX}-rec1`, timestamp: "2026-08-16T00:00:00.000Z" };
  const jsonl = JSON.stringify(record) + "\n";
  console.log(`  payload: 1 JSONL record, ${Buffer.byteLength(jsonl)} bytes, fields ${Object.keys(record).join("+")}`);

  // 1/2. Dataset + batch.
  const created = await withMutations("create dataset", () =>
    tool("aep_create_dataset", { name: NAME, schemaRef: schema.$id, enabledForProfile: false }));
  const dsId = created.datasetId ?? created.id;
  if (!dsId) { console.error("  STOP: no dataset id"); process.exit(1); }
  ledger.created.push({ id: dsId, name: NAME, phase: "1b" }); save();
  console.log(`  dataset: ${dsId}`);

  const batch = await withMutations("create batch", () => tool("aep_create_batch", { datasetId: dsId, format: "json" }));
  const batchId = batch.id ?? batch.batchId;
  if (!batchId) await fail("STOP: no batch id", dsId, null);
  ledger.batches.push({ id: batchId, datasetId: dsId, phase: "2c" }); save();
  console.log(`  batch  : ${batchId} status=${batch.status}`);

  const b0 = await readBatch(batchId);
  const rel = (b0.relatedObjects ?? []).filter((r) => r.type === "dataSet").map((r) => r.id);
  if (rel.length !== 1 || rel[0] !== dsId) await fail("STOP: batch not bound to exactly our dataset", dsId, batchId);
  console.log(`  relatedObjects: ${JSON.stringify(rel)}`);

  // 3. Upload.
  const up = await withMutations("upload", () =>
    tool("aep_upload_batch_file", { batchId, datasetId: dsId, fileName: FILE_NAME, content: jsonl, dryRun: false }));
  if (!up.uploaded) await fail(`STOP: upload failed — ${JSON.stringify(up).slice(0,160)}`, dsId, batchId);
  console.log(`  upload : ok, ${up.bytesUploaded} bytes`);

  // 4. Still loading?
  const b1 = await readBatch(batchId);
  console.log(`  status before COMPLETE: ${b1.status}`);
  if (String(b1.status).toLowerCase() !== "loading") await fail(`STOP: unexpected pre-COMPLETE status ${b1.status}`, dsId, batchId);

  // 4b. EMERGENCY CLEANUP SCRIPT, pinned, written BEFORE the irreversible step.
  const emergency = `scripts/emergency-cleanup-${RUN_ID}.mjs`;
  wf(emergency, [
    "#!/usr/bin/env node",
    "// AUTO-GENERATED before Phase 2C's COMPLETE. Pinned to exactly one run.",
    "// Takes no arguments and can target nothing else.",
    `const DATASET_ID = ${JSON.stringify(dsId)};`,
    `const BATCH_ID   = ${JSON.stringify(batchId)};`,
    `const PREFIX     = ${JSON.stringify(PREFIX)};`,
    "console.log('Pinned emergency cleanup for:', { DATASET_ID, BATCH_ID, PREFIX });",
    "console.log('Run: node scripts/cleanup-pinned.mjs --dataset', DATASET_ID);",
  ].join("\n"));
  console.log(`  emergency script: ${emergency} (pinned, no arguments)`);
  note("phase2c.emergencyScript", { path: emergency, datasetId: dsId, batchId });

  // 5. COMPLETE dry run.
  const dryC = await tool("aep_complete_batch", { batchId, dryRun: true });
  console.log(`  COMPLETE dryRun sent=${dryC.sent}`);
  if (dryC.sent !== false) await fail("STOP: COMPLETE dryRun sent a request", dsId, batchId);

  // 6/7/8. COMPLETE for real.
  const done = await withMutations("COMPLETE batch", () =>
    tool("aep_complete_batch", { batchId, dryRun: false, confirm: `COMPLETE BATCH ${batchId}` }));
  console.log(`  COMPLETE: ${done.completed ? "accepted (200)" : JSON.stringify(done).slice(0,160)}`);
  if (!done.completed) await fail("STOP: COMPLETE was not accepted", dsId, batchId);

  // 9/10. Poll. Acceptance is not ingestion.
  let st = null, metrics = null, waited = 0;
  for (const w of [0, 2000, 4000, 8000, 15000, 30000, 60000, 120000]) {
    if (w) { await new Promise((r) => setTimeout(r, w)); waited += w; }
    const b = await readBatch(batchId);
    st = String(b?.status ?? "gone").toLowerCase();
    metrics = b?.metrics ?? null;
    console.log(`   poll +${Math.round(waited/1000)}s -> ${st}`);
    if (["success", "active", "failed", "failure"].includes(st)) break;
  }
  note("phase2c.complete", { finalStatus: st, waitedMs: waited, metrics });

  if (["failed", "failure"].includes(st)) await fail(`STOP: batch FAILED. Not reverting. metrics=${JSON.stringify(metrics)}`, dsId, batchId);
  if (!["success", "active"].includes(st)) await fail(`STOP: batch never reached Active/Success (last=${st}, waited ${Math.round(waited/1000)}s)`, dsId, batchId);

  // 11. Exactly one promoted record?
  const b2 = await readBatch(batchId);
  const m = b2?.metrics ?? {};
  const promoted = m.outputRecordCount ?? m.outputRecordSize ?? m.inputRecordCount ?? null;
  console.log(`  metrics: ${JSON.stringify(m)}`);
  const exactlyOne = promoted === 1;
  console.log(`  promoted records: ${promoted ?? "(metric unavailable)"} ${exactlyOne ? "" : "<- not authoritative"}`);

  // 12. REVERT.
  const dryR = await tool("aep_revert_batch", { batchId, dryRun: true });
  console.log(`  REVERT dryRun sent=${dryR.sent}`);
  assertBatchOwned(ledger, batchId);
  const rev = await withMutations("REVERT batch", () =>
    tool("aep_revert_batch", { batchId, dryRun: false, confirm: `REVERT BATCH ${batchId}` }));
  console.log(`  REVERT: ${rev.reverted ? "accepted" : JSON.stringify(rev).slice(0,200)}`);

  // 13/14/15. Authoritative post-REVERT state.
  let revState = null;
  for (const w of [0, 2000, 5000, 10000, 20000]) {
    if (w) await new Promise((r) => setTimeout(r, w));
    const b = await readBatch(batchId);
    revState = b === null ? "not-found" : String(b.status).toLowerCase();
    console.log(`   revert poll -> ${revState}`);
    if (["inactive", "deleted", "not-found"].includes(revState)) break;
  }
  const revertOk = ["inactive", "deleted", "not-found"].includes(revState);
  note("phase2c.revert", { accepted: Boolean(rev.reverted), finalState: revState });

  // 16/17/18. Dataset cleanup regardless.
  assertDeletable(ledger, dsId);
  const del = await withMutations("delete dataset", () =>
    tool("aep_delete_dataset", { datasetId: dsId, dryRun: false, confirm: `DELETE DATASET ${dsId}` }));
  console.log(`  dataset delete: cleanupConfirmed=${del.cleanupConfirmed} getStatus=${del.postDeleteGetStatus}`);

  const final = await listDatasets();
  const ids = new Set(final.map((d) => d.id));
  const missing = ledger.baseline.ids.filter((x) => !ids.has(x));
  const ours = final.filter((d) => String(d.name).startsWith(PREFIX));
  console.log(`  baseline present: ${ledger.baseline.ids.length - missing.length}/${ledger.baseline.ids.length}`);
  console.log(`  run-prefix remaining: ${ours.length}`);

  // 19.
  const bFinal = await readBatch(batchId);
  const batchFinal = bFinal === null ? "not-found" : String(bFinal.status).toLowerCase();
  console.log(`  batch final: ${batchFinal}`);

  ledger.outcomes = {
    dataset: { id: dsId, name: NAME, state: del.cleanupConfirmed ? "deleted" : "NOT DELETED", postDeleteGetStatus: del.postDeleteGetStatus },
    batch: { id: batchId, completeReached: st, promotedRecords: promoted, revertAccepted: Boolean(rev.reverted), finalState: batchFinal },
  };
  save();

  const allOk = up.uploaded && done.completed && ["success","active"].includes(st) && exactlyOne && revertOk && del.cleanupConfirmed && !missing.length && !ours.length;
  if (!allOk) {
    console.error("\n  PHASE 2C NOT FULLY VALIDATED:");
    console.error(`    upload=${Boolean(up.uploaded)} complete=${Boolean(done.completed)} status=${st} exactlyOneRecord=${exactlyOne} revert=${revertOk} datasetDeleted=${del.cleanupConfirmed} baselineIntact=${!missing.length}`);
    process.exit(1);
  }
  console.log("\n  PHASE 2C COMPLETE — one record promoted, reverted, dataset removed.");
}

if (phase === "3a") {
  console.log("PHASE 3A — expiration create/update/cancel on an empty dataset.\n");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { z } = await import("zod");
  const { writeFileSync: wf } = await import("node:fs");

  const reg = new Map();
  registerAllTools(
    { registerTool: (n, meta, h) => reg.set(n, { meta, h }), tool: (n, d, sc, h) => reg.set(n, { meta: { inputSchema: sc }, h }) },
    { client, tokenCache: new TokenCache(creds), credentials: creds },
  );
  const tool = async (name, a) => {
    const { meta, h } = reg.get(name);
    return JSON.parse((await h(z.object(meta.inputSchema ?? {}).parse(a), {})).content[0].text);
  };
  const NAME = `${PREFIX}-phase3a`;
  const E1 = "2035-12-31T00:00:00Z";
  const E2 = "2036-12-31T00:00:00Z";
  const ACTIVE_TTL = new Set(["pending", "executing"]);

  /** Every TTL visible to us, id -> status. Read-only. */
  const listTtls = async () => {
    const r = await client.request({ method: "GET", path: "/data/core/hygiene/ttl", query: { limit: 100 } })
      .catch(() => null);
    const rows = Array.isArray(r) ? r : (r?.results ?? r?.children ?? []);
    return rows.map((x) => ({ ttlId: x.ttlId ?? x.id, datasetId: x.datasetId, status: String(x.status ?? "").toLowerCase() }))
      .filter((x) => x.ttlId);
  };
  const getTtl = async (id) =>
    tool("aep_get_dataset_expiration", { id, includeHistory: false }).catch(() => null);

  let dsId = null, ttlId = null;
  const bail = async (why, extra = {}) => {
    console.error(`\n  ${why}`);
    console.error(`  datasetId=${dsId} ttlId=${ttlId} ${JSON.stringify(extra)}`);
    if (ttlId) {
      const cur = await getTtl(ttlId);
      const st = String(cur?.status ?? "unknown").toLowerCase();
      if (ACTIVE_TTL.has(st)) {
        console.error("  attempting pinned cancellation before anything else…");
        const c = await withMutations("cancel TTL (recovery)", () =>
          tool("aep_cancel_dataset_expiration", { id: ttlId, dryRun: false, confirm: `CANCEL DATASET EXPIRATION ${ttlId}` }),
        ).catch((e) => ({ error: String(e?.message) }));
        if (!c?.cancelled) {
          console.error(`  CANCELLATION NOT CONFIRMED. Leaving dataset ${dsId} INTACT for inspection.`);
          console.error(`  ttl status: ${(await getTtl(ttlId))?.status}`);
          process.exit(1);
        }
        console.error("  cancellation confirmed.");
      } else {
        console.error(`  ttl status is '${st}' — not active, no cancellation needed.`);
      }
    }
    if (dsId) {
      await withMutations("delete dataset (recovery)", () =>
        tool("aep_delete_dataset", { datasetId: dsId, dryRun: false, confirm: `DELETE DATASET ${dsId}` }),
      ).catch((e) => console.error("  recovery delete failed:", e?.message));
    }
    process.exit(1);
  };

  // ---- 1. Refreshed read-only baseline: datasets AND ttls -----------------
  const baseDatasets = await listDatasets();
  const baseTtls = await listTtls();
  ledger.baseline = {
    datasetIds: baseDatasets.map((d) => d.id),
    ttls: baseTtls.map((t2) => ({ ttlId: t2.ttlId, status: t2.status })),
  };
  save();
  const preexistingPrefix = baseDatasets.filter((d) => String(d.name).startsWith(PREFIX));
  console.log(`  1. baseline: ${baseDatasets.length} datasets, ${baseTtls.length} TTLs`);
  console.log(`     TTL statuses: ${JSON.stringify(baseTtls.reduce((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {}))}`);
  console.log(`     objects with this run's prefix: ${preexistingPrefix.length}`);
  if (preexistingPrefix.length) { console.error("  STOP: run prefix already present"); process.exit(1); }

  const schemas = await client.request({
    method: "GET", path: "/data/foundation/schemaregistry/tenant/schemas",
    query: { limit: 100 }, headers: { Accept: "application/vnd.adobe.xed-id+json" },
  });
  const schema = (schemas.results ?? []).find((x) => x.title === "AJO Channel Tracking Event Schema");
  if (!schema) { console.error("  STOP: validated schema not found"); process.exit(1); }

  // ---- 2. One empty, Profile-disabled dataset -----------------------------
  const created = await withMutations("create dataset", () =>
    tool("aep_create_dataset", { name: NAME, schemaRef: schema.$id, enabledForProfile: false }));
  dsId = created.datasetId ?? created.id;
  if (!dsId) { console.error("  STOP: no dataset id returned"); process.exit(1); }
  ledger.created.push({ id: dsId, name: NAME, phase: "1b" }); save();
  console.log(`  2. dataset: ${dsId} (empty, Profile disabled)`);

  // ---- 3. Pinned emergency script, BEFORE any TTL mutation ----------------
  const emergency = `scripts/emergency-cleanup-3a-${RUN_ID}.mjs`;
  const writeEmergency = (ttl) => wf(emergency, [
    "#!/usr/bin/env node",
    "// AUTO-GENERATED. Pinned to one run. Accepts NO runtime ids.",
    "// Order is deliberate: cancel a pending TTL BEFORE deleting the dataset.",
    `const DATASET_ID = ${JSON.stringify(dsId)};`,
    `const TTL_ID     = ${JSON.stringify(ttl)};`,
    `const PREFIX     = ${JSON.stringify(PREFIX)};`,
    "console.log('Pinned Phase 3A cleanup:', { DATASET_ID, TTL_ID, PREFIX });",
    "console.log('1) cancel TTL_ID if pending/executing  2) delete DATASET_ID');",
  ].join("\n"));
  writeEmergency(null);
  const { readFileSync: rf } = await import("node:fs");
  const emergencyBefore = rf(emergency, "utf8");
  console.log(`  3. emergency script written BEFORE any TTL mutation: ${emergency}`);
  console.log(`     contains datasetId: ${emergencyBefore.includes(dsId)}  accepts argv: ${/process\.argv/.test(emergencyBefore)}`);

  // ---- 4. create dryRun ---------------------------------------------------
  const dc = await tool("aep_create_dataset_expiration", {
    datasetId: dsId, expiry: E1, displayName: `${PREFIX}-ttl-original`,
    description: "Phase 3A reversible dataset-expiration validation", dryRun: true,
  });
  console.log(`  4. create dryRun sent=${dc.sent}`);
  if (dc.sent !== false) await bail("STOP: create dryRun sent a request");

  // ---- 5. Create the expiration ------------------------------------------
  const ex = await withMutations("create expiration", () =>
    tool("aep_create_dataset_expiration", {
      datasetId: dsId, expiry: E1, displayName: `${PREFIX}-ttl-original`,
      description: "Phase 3A reversible dataset-expiration validation",
      dryRun: false, confirm: `CREATE DATASET EXPIRATION ${dsId}`,
    }));
  ttlId = ex.ttlId ?? ex.id ?? null;
  console.log(`  5. create: ttlId=${ttlId} datasetId=${ex.datasetId ?? "(not echoed)"} status=${ex.status ?? "?"}`);
  if (!ttlId) await bail(`STOP: no ttlId returned — ${JSON.stringify(ex).slice(0, 200)}`);
  ledger.ttls = [{ id: ttlId, datasetId: dsId, phase: "3a" }]; save();
  writeEmergency(ttlId);
  console.log(`     emergency script updated with ttlId: ${rf(emergency, "utf8").includes(ttlId)}`);

  // ---- 6. Four read-only verifications ------------------------------------
  const byTtl = await getTtl(ttlId);
  const byDs = await getTtl(dsId);
  const withHist = await tool("aep_get_dataset_expiration", { id: ttlId, includeHistory: true }).catch(() => null);
  const listed = (await listTtls()).filter((x) => x.datasetId === dsId);
  console.log(`  6. GET by ttlId    : status=${byTtl?.status} expiry=${byTtl?.expiry}`);
  console.log(`     GET by datasetId: ttlId=${byDs?.ttlId} status=${byDs?.status}`);
  console.log(`     GET +history    : entries=${Array.isArray(withHist?.history) ? withHist.history.length : "n/a"}`);
  console.log(`     list by dataset : ${listed.length} match(es) -> ${JSON.stringify(listed)}`);
  const agree = byTtl?.status === "pending" && byDs?.ttlId === byTtl?.ttlId && listed.length === 1 && listed[0].ttlId === ttlId;
  console.log(`     all four agree  : ${agree}`);
  if (!agree) await bail("STOP: the four read paths disagree");

  // ---- 7/8. Update ---------------------------------------------------------
  const du = await tool("aep_update_dataset_expiration", { ttlId, expiry: E2, dryRun: true });
  console.log(`  7. update dryRun sent=${du.sent}`);
  if (du.sent !== false) await bail("STOP: update dryRun sent a request");

  const up = await withMutations("update expiration", () =>
    tool("aep_update_dataset_expiration", {
      ttlId, expiry: E2, displayName: `${PREFIX}-ttl-updated`,
      description: "Phase 3A updated before cancellation",
      dryRun: false, confirm: `UPDATE DATASET EXPIRATION ${ttlId}`,
    }));
  const after = await getTtl(ttlId);
  const histAfter = await tool("aep_get_dataset_expiration", { id: ttlId, includeHistory: true }).catch(() => null);
  console.log(`  8. update: status=${after?.status} expiry=${after?.expiry} displayName=${after?.displayName}`);
  console.log(`     ttlId unchanged=${after?.ttlId === byTtl?.ttlId} datasetId unchanged=${after?.datasetId === byTtl?.datasetId}`);
  console.log(`     history entries: ${Array.isArray(histAfter?.history) ? histAfter.history.length : "not exposed"}`);
  if (String(after?.status).toLowerCase() !== "pending") await bail(`STOP: status after update is ${after?.status}`);

  // ---- 9/10. Cancel --------------------------------------------------------
  const dcx = await tool("aep_cancel_dataset_expiration", { id: ttlId, dryRun: true });
  console.log(`  9. cancel dryRun sent=${dcx.sent}`);
  if (dcx.sent !== false) await bail("STOP: cancel dryRun sent a request");

  const cur = await getTtl(ttlId);
  if (String(cur?.status).toLowerCase() === "cancelled") {
    console.log(" 10. already cancelled — not re-cancelling");
  } else {
    const cx = await withMutations("cancel expiration", () =>
      tool("aep_cancel_dataset_expiration", { id: ttlId, dryRun: false, confirm: `CANCEL DATASET EXPIRATION ${ttlId}` }));
    console.log(` 10. cancel: ${cx.cancelled ? `confirmed status=${cx.statusAfter}` : JSON.stringify(cx).slice(0,200)}`);
    if (!cx.cancelled) await bail("STOP: cancellation not confirmed — leaving dataset intact", { ttlStatus: (await getTtl(ttlId))?.status });
  }

  const postCancel = await getTtl(ttlId);
  const activeForDs = (await listTtls()).filter((x) => x.datasetId === dsId && ACTIVE_TTL.has(x.status));
  console.log(`     follow-up GET status: ${postCancel?.status}`);
  console.log(`     active TTLs still on this dataset: ${activeForDs.length}`);
  if (activeForDs.length) await bail("STOP: an active TTL remains on the dataset");

  // Catalog tag observation — reported, never the authority.
  const dsRec = await getDataset(dsId);
  const ttlTag = JSON.stringify(dsRec?.tags ?? {}).includes("ttl");
  console.log(`     Catalog adobe/hygiene/ttl tag present: ${ttlTag} (observation only)`);

  // ---- 11. Delete the dataset ---------------------------------------------
  assertDeletable(ledger, dsId);
  const del = await withMutations("delete dataset", () =>
    tool("aep_delete_dataset", { datasetId: dsId, dryRun: false, confirm: `DELETE DATASET ${dsId}` }));
  console.log(` 11. dataset delete: cleanupConfirmed=${del.cleanupConfirmed} getStatus=${del.postDeleteGetStatus}`);

  // ---- 12. Final verification ----------------------------------------------
  const finalDatasets = await listDatasets();
  const finalIds = new Set(finalDatasets.map((d) => d.id));
  const missingDs = ledger.baseline.datasetIds.filter((x) => !finalIds.has(x));
  const oursLeft = finalDatasets.filter((d) => String(d.name).startsWith(PREFIX));
  const added = finalDatasets.filter((d) => !ledger.baseline.datasetIds.includes(d.id) && !String(d.name).startsWith(PREFIX));

  const finalTtls = await listTtls();
  const finalTtlIds = new Set(finalTtls.map((x) => x.ttlId));
  const missingBaseTtls = ledger.baseline.ttls.filter((b) => !finalTtlIds.has(b.ttlId));
  const ourActive = finalTtls.filter((x) => x.ttlId === ttlId && ACTIVE_TTL.has(x.status));
  const ourCancelled = finalTtls.filter((x) => x.ttlId === ttlId && x.status === "cancelled");

  console.log(` 12. baseline datasets preserved: ${ledger.baseline.datasetIds.length - missingDs.length}/${ledger.baseline.datasetIds.length}`);
  console.log(`     baseline TTLs preserved     : ${ledger.baseline.ttls.length - missingBaseTtls.length}/${ledger.baseline.ttls.length}`);
  console.log(`     run-prefix datasets left    : ${oursLeft.length}`);
  console.log(`     run-owned ACTIVE TTLs left  : ${ourActive.length}`);
  console.log(`     run-owned CANCELLED audit   : ${ourCancelled.length} (expected, not an orphan)`);
  console.log(`     concurrent additions        : ${added.length} (untouched)`);

  ledger.outcomes = {
    dataset: { id: dsId, state: del.cleanupConfirmed ? "deleted" : "NOT DELETED", postDeleteGetStatus: del.postDeleteGetStatus },
    expiration: { ttlId, created: E1, updatedTo: E2, finalStatus: postCancel?.status ?? null,
      classification: "cancelled audit record — expected to persist, not an orphan" },
  };
  save();

  const ok = del.cleanupConfirmed && !missingDs.length && !missingBaseTtls.length && !oursLeft.length && !ourActive.length;
  if (!ok) {
    console.error("\n  PHASE 3A NOT FULLY VALIDATED:");
    console.error(`    datasetDeleted=${Boolean(del.cleanupConfirmed)} baselineDatasets=${!missingDs.length} baselineTtls=${!missingBaseTtls.length} prefixLeft=${oursLeft.length} activeTtlLeft=${ourActive.length}`);
    process.exit(1);
  }
  console.log("\n  PHASE 3A COMPLETE — expiration created, updated, cancelled; dataset removed.");
}

console.log(`\nledger written: ${LEDGER}`);
