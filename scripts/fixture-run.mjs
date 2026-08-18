#!/usr/bin/env node
/**
 * Creates the minimum throwaway fixtures needed to exercise read-only tools
 * that require an id, then deletes them again.
 *
 * Nine read-only tools could not be validated because this sandbox contains no
 * segment, query, profile, privacy job or work order to read. Guessing an id is
 * not an option — a fabricated id returns 404, which is indistinguishable from
 * a broken tool. So the fixtures are made, used, and removed.
 *
 * SCOPE, and what is deliberately NOT here:
 *   - segment + query ARE created. Both are cheap, sandbox-local, and
 *     removable (segment via aep_delete_segment; a query is a record, not data).
 *   - profile / identity fixtures are NOT created. They need ingested profile
 *     data, and Profile reports SAMPLE_NOT_READY with no rows in this sandbox.
 *   - a privacy job is NOT created. It is a real regulatory request, not a
 *     test fixture, and this sandbox is shared.
 *   - a hygiene work order is NOT created. Permanently forbidden here: it is
 *     asynchronous, non-cancellable, and can take 30 days.
 *
 * Every created object is written to a ledger BEFORE creation, so a crash
 * leaves a record to clean up from rather than an orphan nobody knows about.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const envFile = args[args.indexOf("--env") + 1];
if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const RUN_ID = randomUUID();
const PREFIX = `mcpfix-${new Date().toISOString().slice(0, 10)}`;
const LEDGER = `docs/run-ledgers/fixture-${RUN_ID}.json`;
const fp = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);

const EXPECTED_ORG = process.env.AEP_EXPECTED_ORG_ID;
const EXPECTED_SBX = process.env.AEP_EXPECTED_SANDBOX_NAME;
if (!EXPECTED_ORG || !EXPECTED_SBX) {
  console.error("REFUSING: set AEP_EXPECTED_ORG_ID and AEP_EXPECTED_SANDBOX_NAME.");
  process.exit(2);
}
if (!has("--commit")) {
  console.error("Dry run. This script creates and deletes real objects; pass --commit to proceed.");
  process.exit(0);
}
// Fixtures are writes, so mutations must be explicitly on.
process.env.AEP_ALLOW_MUTATIONS = "true";

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
if (info.type !== "development") {
  console.error(`REFUSING: sandbox type is '${info.type}', not development.`);
  process.exit(2);
}

const tools = new Map();
registerAllTools(
  { registerTool: (n, cfg, h) => tools.set(n, { cfg, handler: h }), tool: (n, _d, _s, h) => tools.set(n, { cfg: {}, handler: h }) },
  { client, tokenCache: new TokenCache(creds), credentials: creds },
);
const call = async (name, a = {}) => {
  const t = tools.get(name);
  if (!t) return { ok: false, detail: "not registered" };
  const parsed = t.cfg?.inputSchema ? z.object(t.cfg.inputSchema).parse(a) : a;
  const res = await t.handler(parsed, {});
  let payload = null; try { payload = JSON.parse(res.content[0].text); } catch {}
  return { ok: !res.isError, payload };
};

const ledger = { runId: RUN_ID, prefix: PREFIX, sandbox: creds.sandboxName, created: [], events: [] };
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
const note = (e, d) => { ledger.events.push({ e, d, at: new Date().toISOString() }); save(); };
save();
console.log(`run ${RUN_ID}\nledger ${LEDGER}\n`);

const results = [];
const record = (tool, ok, detail = "") => { results.push({ tool, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${tool} ${detail}`); };

// ---------------------------------------------------------------- SEGMENT
console.log("SEGMENT fixture");
let segmentId;
try {
  ledger.created.push({ type: "segment", pending: true, name: `${PREFIX}-seg` }); save();
  const made = await call("aep_create_segment", {
    name: `${PREFIX}-seg`,
    description: "Throwaway fixture for read-only tool validation. Safe to delete.",
    pqlExpression: "homeAddress.countryCode = \"US\"",
  });
  segmentId = made.payload?.id ?? made.payload?.segmentId ?? made.payload?.segment?.id;
  if (!segmentId) throw new Error(`no id in create response: ${JSON.stringify(made.payload).slice(0, 200)}`);
  ledger.created[ledger.created.length - 1] = { type: "segment", id: segmentId, name: `${PREFIX}-seg` }; save();
  note("segment_created", segmentId);
  console.log(`  created ${segmentId}`);

  const got = await call("aep_get_segment", { segmentId });
  record("aep_get_segment", got.ok, got.ok ? "" : JSON.stringify(got.payload).slice(0, 90));

  const est = await call("aep_estimate_segment_size", { segmentId });
  record("aep_estimate_segment_size", est.ok, est.ok ? "" : (est.payload?.code ?? ""));
} catch (e) {
  // Creation failed. Drop the pending placeholder — Zod and the write guard
  // both reject before any network call, so a failure here means nothing was
  // created and a lingering row would be a phantom orphan, which is worse than
  // no record at all: it sends the next person hunting for something that
  // never existed.
  ledger.created = ledger.created.filter((c) => !c.pending); save();
  note("segment_create_failed", String(e.message).slice(0, 200));
  record("aep_get_segment", false, String(e.message).slice(0, 120));
}

// ------------------------------------------------------------------ QUERY
console.log("\nQUERY fixture");
try {
  const q = await call("aep_run_query", {
    sql: "SELECT 1",
    name: `${PREFIX}-query`,
  });
  const queryId = q.payload?.id ?? q.payload?.queryId;
  if (queryId) {
    note("query_created", queryId);
    console.log(`  created ${queryId}`);
    const st = await call("aep_get_query_status", { queryId });
    record("aep_get_query_status", st.ok, st.ok ? `state=${st.payload?.state ?? "?"}` : (st.payload?.code ?? ""));
  } else {
    record("aep_get_query_status", false, `run_query returned no id: ${JSON.stringify(q.payload).slice(0, 120)}`);
  }
} catch (e) {
  record("aep_get_query_status", false, String(e.message).slice(0, 120));
}

// ---------------------------------------------------------------- CLEANUP
console.log("\nCLEANUP");
if (segmentId) {
  const del = await call("aep_delete_segment", { segmentId, dryRun: false, confirm: `DELETE SEGMENT ${segmentId}` });
  if (del.ok && del.payload?.verifiedGone) {
    note("segment_deleted", segmentId);
    ledger.created = ledger.created.filter((c) => c.id !== segmentId); save();
    console.log(`  segment ${segmentId} deleted and verified gone`);
  } else {
    console.error(`  !! segment ${segmentId} NOT confirmed deleted — ${JSON.stringify(del.payload).slice(0, 160)}`);
    console.error(`  !! ORPHAN. Ledger: ${LEDGER}`);
    process.exitCode = 1;
  }
}
// A query is an execution record, not stored data. Adobe expires them; there is
// no delete endpoint, and nothing to orphan.
console.log("  query left as an execution record (no delete endpoint; not stored data)");

const orphans = ledger.created.length;
note("run_complete", { orphans });
console.log(`\n${results.filter(r => r.ok).length}/${results.length} fixture-backed tools passed · orphans left: ${orphans}`);
if (orphans > 0) process.exitCode = 1;
