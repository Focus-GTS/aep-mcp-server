#!/usr/bin/env node
/**
 * One-off authorised cleanup of the Phase 2A test dataset.
 *
 * The target id and name prefix are PINNED as constants. This script cannot be
 * pointed at anything else without editing it, which is the intent: the
 * authorisation was for exactly one object, so the code should encode exactly
 * one object rather than accept an argument.
 *
 *   node scripts/cleanup-phase2a.mjs --env .env
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

// ---- The authorisation, expressed as code --------------------------------
const AUTHORISED_DATASET_ID = "6a806a523f28337cd176d85b";
const REQUIRED_NAME_PREFIX = "mcpval-2026-08-15-bafd9ba7-";
const LINKED_BATCH_ID = "01M02SYNYCKQ6YMD5SBGXC5ZX7";

const args = process.argv.slice(2);
const envFile = args[args.indexOf("--env") + 1];
if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { loadCredentials } = await import("../dist/auth/credentials.js");
const { AepClient } = await import("../dist/auth/aep-client.js");
const { TokenCache } = await import("../dist/auth/token-cache.js");
const { resolveSandbox } = await import("../dist/auth/sandbox-guard.js");
const { registerAllTools } = await import("../dist/tools/index.js");
const { z } = await import("zod");

const creds = loadCredentials();
if (creds.sandboxName !== "focusgts-ucp") {
  console.error(`REFUSING: sandbox is '${creds.sandboxName}'`);
  process.exit(2);
}
const client = new AepClient(creds, new TokenCache(creds));
const info = await resolveSandbox(client, creds);
client.setSandboxInfo(info);
if (info.type !== "development") {
  console.error(`REFUSING: sandbox type is '${info.type}'`);
  process.exit(2);
}
console.log(`sandbox: ${info.name} type=${info.type} state=${info.state}\n`);

const reg = new Map();
registerAllTools(
  { registerTool: (n, m, h) => reg.set(n, { m, h }), tool: (n, d, s, h) => reg.set(n, { m: { inputSchema: s }, h }) },
  { client, tokenCache: new TokenCache(creds), credentials: creds },
);
const tool = async (name, a) => {
  const { m, h } = reg.get(name);
  return JSON.parse((await h(z.object(m.inputSchema ?? {}).parse(a), {})).content[0].text);
};

async function withMutations(label, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "AEP_ALLOW_MUTATIONS");
  const prev = process.env.AEP_ALLOW_MUTATIONS;
  process.env.AEP_ALLOW_MUTATIONS = "true";
  console.log(`  [mutations ENABLED: ${label}]`);
  try { return await fn(); }
  finally {
    if (had) process.env.AEP_ALLOW_MUTATIONS = prev; else delete process.env.AEP_ALLOW_MUTATIONS;
    console.log(`  [mutations DISABLED — AEP_ALLOW_MUTATIONS=${process.env.AEP_ALLOW_MUTATIONS ?? "(unset)"}]`);
  }
}

const listDatasets = async () => {
  const out = [];
  for (let start = 0; ; start += 100) {
    const r = await client.request({
      method: "GET", path: "/data/foundation/catalog/dataSets", query: { limit: 100, start },
    });
    const page = Object.entries(r ?? {}).map(([id, v]) => ({ id, name: v?.name ?? "" }));
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
};

// ---- 1/2. Preconditions ---------------------------------------------------
console.log("1. GET the exact dataset id");
const ds = await client
  .request({ method: "GET", path: `/data/foundation/catalog/dataSets/${AUTHORISED_DATASET_ID}` })
  .then((r) => Object.entries(r ?? {}).find(([k]) => k === AUTHORISED_DATASET_ID)?.[1] ?? null)
  .catch((e) => (e?.status === 404 ? null : Promise.reject(e)));

if (!ds) { console.error("   ABORT: dataset not found. Nothing to do."); process.exit(1); }

const checks = {
  prefix: String(ds.name).startsWith(REQUIRED_NAME_PREFIX),
  profileDisabled: !(ds.tags?.unifiedProfile ?? []).includes("enabled:true"),
};
console.log(`   name            : ${ds.name}`);
console.log(`   expected prefix : ${checks.prefix ? "MATCH" : "MISMATCH"}`);
console.log(`   Profile disabled: ${checks.profileDisabled}`);

// Batches attached to this dataset, and the linked batch's state.
const batchList = await client.request({
  method: "GET", path: "/data/foundation/catalog/batches",
  query: { limit: 100, dataSet: AUTHORISED_DATASET_ID },
}).catch(() => ({}));
const attached = Object.entries(batchList ?? {}).map(([id, v]) => ({ id, status: v?.status }));
console.log(`   batches attached: ${attached.length} -> ${JSON.stringify(attached).slice(0, 160)}`);

const linked = await tool("aep_get_batch_status", { batchId: LINKED_BATCH_ID }).catch(() => null);
const linkedStatus = linked?.status ?? "(unreadable)";
console.log(`   linked batch    : ${LINKED_BATCH_ID} status=${linkedStatus}`);

const ingested = attached.some((b) => String(b.status).toLowerCase() === "success");
console.log(`   any ingested records: ${ingested ? "YES" : "no"}`);

if (!checks.prefix || !checks.profileDisabled || ingested || linkedStatus !== "aborted") {
  console.error("\n   ABORT: a precondition failed. No deletion attempted.");
  process.exit(1);
}

// ---- 3. dryRun ------------------------------------------------------------
console.log("\n3. delete dryRun");
const dry = await tool("aep_delete_dataset", { datasetId: AUTHORISED_DATASET_ID, dryRun: true });
console.log(`   sent: ${dry.sent}`);
if (dry.sent !== false) { console.error("   ABORT: dryRun sent a request"); process.exit(1); }

// ---- 4. Ledger ownership --------------------------------------------------
console.log("\n4. ledger ownership");
const ledgerFile = readdirSync("docs/run-ledgers")
  .map((f) => `docs/run-ledgers/${f}`)
  .find((f) => JSON.parse(readFileSync(f, "utf8")).created?.some((c) => c.id === AUTHORISED_DATASET_ID));
if (!ledgerFile) { console.error("   ABORT: id not found in any run ledger"); process.exit(1); }
const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
const { assertDeletable } = await import("./run-ledger.mjs");
assertDeletable(ledger, AUTHORISED_DATASET_ID);
console.log(`   passed (${ledgerFile})`);

const baselineBefore = await listDatasets();

// ---- 5/6/7. The one authorised mutation -----------------------------------
console.log("\n6. delete");
const del = await withMutations("delete dataset", () =>
  tool("aep_delete_dataset", {
    datasetId: AUTHORISED_DATASET_ID,
    dryRun: false,
    confirm: `DELETE DATASET ${AUTHORISED_DATASET_ID}`,
  }),
);
console.log(`   deleteOutcome              : ${del.deleteOutcome ?? del.code}`);
console.log(`   matchedDocumentation       : ${del.deleteResponseMatchedDocumentation}`);
console.log(`   responseContractMismatch   : ${del.responseContractMismatch ?? "none"}`);
console.log(`   postDeleteGetStatus        : ${del.postDeleteGetStatus}`);
console.log(`   cleanupConfirmed           : ${del.cleanupConfirmed}`);
console.log(`   retryPerformed             : ${del.retryPerformed}`);

// ---- 8. Authoritative check ----------------------------------------------
const after = await client
  .request({ method: "GET", path: `/data/foundation/catalog/dataSets/${AUTHORISED_DATASET_ID}` })
  .then(() => "STILL EXISTS")
  .catch((e) => (e?.status === 404 ? "404 — gone" : `unexpected ${e?.status}`));
console.log(`\n8. GET after delete: ${after}`);

// ---- 9. Baseline ----------------------------------------------------------
const final = await listDatasets();
const survivors = final.filter((d) => d.name.startsWith("mcpval-"));
console.log(`\n9. datasets now: ${final.length} (was ${baselineBefore.length})`);
console.log(`   mcpval-* remaining: ${survivors.length}`);

// ---- 10. Batch final state ------------------------------------------------
const batchAfter = await tool("aep_get_batch_status", { batchId: LINKED_BATCH_ID }).catch((e) => ({ status: `unreadable (${e?.status})` }));
console.log(`\n10. batch ${LINKED_BATCH_ID}: ${batchAfter.status}`);

// ---- Ledger update --------------------------------------------------------
ledger.outcomes = {
  dataset: {
    id: AUTHORISED_DATASET_ID,
    name: ds.name,
    state: del.cleanupConfirmed ? "deleted" : "NOT DELETED",
    cleanupConfirmed: Boolean(del.cleanupConfirmed),
    postDeleteGetStatus: del.postDeleteGetStatus ?? null,
  },
  batch: {
    id: LINKED_BATCH_ID,
    state: "terminal-aborted",
    dataIngested: false,
    classification:
      "Terminal audit metadata, not an active orphan. The batch was never completed, " +
      "ingested no records, and 'aborted' is the correct terminal state for a cancelled batch. " +
      "REVERT is not applicable — Adobe returns 428 ERR-BI-104 for an already-aborted batch.",
  },
};
writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
console.log(`\nledger updated: ${ledgerFile}`);

process.exit(del.cleanupConfirmed && after === "404 — gone" ? 0 : 1);
