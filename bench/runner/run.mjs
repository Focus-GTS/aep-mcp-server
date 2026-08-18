#!/usr/bin/env node
/**
 * AEC-Bench runner.
 *
 *   node bench/runner/run.mjs --env .env --tier 1
 *   node bench/runner/run.mjs --env .env --tier 2 --json results.json
 *
 * Scoring, per task:
 *   completed  the goal state was reached, asserted against Adobe directly
 *   efficient  reached it within expectedCalls tool calls
 *   clean      left no residue (tier 2+)
 *
 * A task scores 1.0 only when all three hold. Partial credit is reported and
 * never rounded up: "it worked but orphaned three datasets" is a result worth
 * seeing, not a rounding error.
 *
 * SAFETY. Tier 2+ refuses to run unless ALL of these hold:
 *   - AEP_EXPECTED_ORG_ID and AEP_EXPECTED_SANDBOX_NAME match the credential
 *   - Adobe classifies the sandbox as `development`
 *   - the sandbox is not named prod/production
 * It fails closed: an unresolvable sandbox type blocks the run.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { TIERS } from "../tasks/schema.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const envFile = opt("--env");
const tier = Number(opt("--tier", "1"));
const jsonOut = opt("--json");

if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!TIERS[tier]) { console.error(`unknown tier ${tier}`); process.exit(2); }

const fp = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);
const { loadCredentials } = await import("../../dist/auth/credentials.js");
const { AepClient } = await import("../../dist/auth/aep-client.js");
const { TokenCache } = await import("../../dist/auth/token-cache.js");
const { resolveSandbox } = await import("../../dist/auth/sandbox-guard.js");
const { registerAllTools } = await import("../../dist/tools/index.js");

// Tier 1 is read-only, so mutations stay off unless a write tier was asked for.
if (tier >= 2) process.env.AEP_ALLOW_MUTATIONS = "true";
else { delete process.env.AEP_ALLOW_MUTATIONS; process.env.AEP_MODE = "read-only"; }

const creds = loadCredentials();
const client = new AepClient(creds, new TokenCache(creds));
const info = await resolveSandbox(client, creds);
client.setSandboxInfo(info);

if (tier >= 2) {
  const eOrg = process.env.AEP_EXPECTED_ORG_ID;
  const eSbx = process.env.AEP_EXPECTED_SANDBOX_NAME;
  if (!eOrg || !eSbx) {
    console.error("REFUSING tier 2+: set AEP_EXPECTED_ORG_ID and AEP_EXPECTED_SANDBOX_NAME.");
    process.exit(2);
  }
  if (creds.orgId !== eOrg || creds.sandboxName !== eSbx) {
    console.error(`REFUSING tier 2+: tenant mismatch (org sha256:${fp(creds.orgId)}, sandbox sha256:${fp(creds.sandboxName)})`);
    process.exit(2);
  }
  if (info.type !== "development") {
    console.error(`REFUSING tier 2+: Adobe classifies this sandbox as '${info.type}', not development.`);
    process.exit(2);
  }
  if (/^prod(uction)?$/i.test(creds.sandboxName)) {
    console.error("REFUSING tier 2+: sandbox is named prod.");
    process.exit(2);
  }
}

const tools = new Map();
registerAllTools(
  { registerTool: (n, cfg, h) => tools.set(n, { cfg, handler: h }), tool: (n, _d, _s, h) => tools.set(n, { cfg: {}, handler: h }) },
  { client, tokenCache: new TokenCache(creds), credentials: creds },
);

let callCount = 0;
const call = async (name, a = {}) => {
  const t = tools.get(name);
  if (!t) return { ok: false, detail: `tool '${name}' is not registered` };
  callCount++;
  const parsed = t.cfg?.inputSchema ? z.object(t.cfg.inputSchema).parse(a) : a;
  const res = await t.handler(parsed, {});
  let payload = null; try { payload = JSON.parse(res.content[0].text); } catch {}
  return { ok: !res.isError, payload };
};

const modules = [
  await import("../tasks/tier1-read.mjs"),
  await import("../tasks/tier2-write.mjs"),
];
const tasks = modules.flatMap((m) => m.default).filter((t) => t.tier === tier);

console.log(`AEC-Bench · tier ${tier} (${TIERS[tier].name}) · sandbox type=${info.type}`);
console.log(`${tasks.length} task(s)\n`);

const env = { client, call, ctx: { sandboxName: creds.sandboxName, orgId: creds.orgId } };
const results = [];

for (const task of tasks) {
  const before = callCount;
  let completed = false, clean = true, cleanDetail = "", error = "";
  try {
    if (task.setup) await task.setup.call(task, env);
    await task.run.call(task, env);
    completed = await task.verify.call(task, env) === true;
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 160);
  }
  const used = callCount - before;
  if (task.cleanup) {
    try {
      const c = await task.cleanup.call(task, env);
      clean = c?.clean === true;
      cleanDetail = c?.detail ?? "";
    } catch (e) { clean = false; cleanDetail = String(e?.message ?? e).slice(0, 120); }
  }
  const efficient = used <= task.expectedCalls;
  // All three must hold. Never rounded up.
  const score = completed && efficient && clean ? 1 : (completed ? (clean ? 0.7 : 0.4) : 0);
  results.push({ id: task.id, tier: task.tier, goal: task.goal, completed, efficient, clean, cleanDetail, calls: used, expectedCalls: task.expectedCalls, score, error });

  const flag = (b) => (b ? "✓" : "✗");
  console.log(`${score === 1 ? "PASS" : "FAIL"}  ${task.id}`);
  console.log(`      complete ${flag(completed)}  efficient ${flag(efficient)} (${used}/${task.expectedCalls})  clean ${flag(clean)}${cleanDetail ? " — " + cleanDetail : ""}`);
  if (error) console.log(`      error: ${error}`);
}

const total = results.reduce((a, r) => a + r.score, 0);
const max = results.length;
console.log(`\nscore ${total.toFixed(1)} / ${max}  (${max ? Math.round((total / max) * 100) : 0}%)`);
const dirty = results.filter((r) => !r.clean);
if (dirty.length) console.log(`RESIDUE LEFT by ${dirty.length} task(s) — investigate before re-running.`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    tier, sandboxType: info.type, when: new Date().toISOString(),
    score: total, max, results,
  }, null, 2));
  console.log(`wrote ${jsonOut}`);
}
process.exit(results.some((r) => r.score < 1) ? 1 : 0);
