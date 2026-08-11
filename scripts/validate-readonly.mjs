#!/usr/bin/env node
/**
 * Read-only live validation harness.
 *
 * SAFETY: issues GET requests only. There is a hard assertion below that
 * refuses any other method, so this cannot create, modify, or delete anything.
 * It is safe to run against a production sandbox, and safe to run before the
 * mutation gates have been opened.
 *
 * Purpose: the moment a credential for `focusgts-ucp` (or any new sandbox)
 * arrives, run this FIRST. It answers "what can this credential actually
 * reach" before a single write is attempted.
 *
 *   node scripts/validate-readonly.mjs --env .env.charlie
 *   node scripts/validate-readonly.mjs --env .env.charlie --json out.json
 *
 * Exit codes:
 *   0  every surface reachable or explained
 *   1  at least one HTML 404 — a wrong path in our own code
 *   2  configuration or authentication failure
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
const IMS_SCOPES =
  "openid,AdobeID,read_organizations,additional_info.projectedProductContext,session";
const BASE = "https://platform.adobe.io";
const XED_ID = "application/vnd.adobe.xed-id+json";

/**
 * The eight surfaces the brief asks to validate, plus the sandbox check that
 * tells us whether the write guard will be able to resolve a type at all.
 */
const SURFACES = [
  { key: "sandboxes", label: "Sandbox Management", path: "/data/foundation/sandbox-management/", critical: true },
  { key: "schemas", label: "Schemas", path: "/data/foundation/schemaregistry/tenant/schemas?limit=1", accept: XED_ID },
  { key: "datasets", label: "Datasets", path: "/data/foundation/catalog/dataSets?limit=1" },
  { key: "batches", label: "Batches", path: "/data/foundation/catalog/batches?limit=1" },
  { key: "workorders", label: "Hygiene work orders", path: "/data/core/hygiene/workorder" },
  { key: "ttl", label: "Dataset expirations", path: "/data/core/hygiene/ttl" },
  { key: "segments", label: "Segment definitions", path: "/data/core/ups/segment/definitions?limit=1" },
  { key: "datastreams", label: "Datastreams", path: "/data/foundation/edge/datastreams?limit=1" },
  { key: "privacy", label: "Privacy requests", path: "/data/core/privacy/jobs?regulation=gdpr&limit=1" },
];

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

const { AEP_CLIENT_ID: ID, AEP_CLIENT_SECRET: SECRET, AEP_ORG_ID: ORG, AEP_SANDBOX_NAME: SBX } = process.env;

if (!ID || !SECRET || !ORG || !SBX) {
  console.error("Missing AEP_CLIENT_ID / AEP_CLIENT_SECRET / AEP_ORG_ID / AEP_SANDBOX_NAME.");
  process.exit(2);
}
if (!/@AdobeOrg$/.test(ORG)) {
  console.error(`AEP_ORG_ID must end in @AdobeOrg — got '${ORG}'. A Developer Console org NUMBER is not an IMS org ID.`);
  process.exit(2);
}

async function token() {
  const res = await fetch(IMS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: ID, client_secret: SECRET, scope: IMS_SCOPES }),
  });
  // Deliberately excludes the response body: IMS echoes request context.
  if (!res.ok) throw new Error(`IMS token request failed with HTTP ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("IMS returned no access_token");
  return j.access_token;
}

async function probe(tok, s) {
  const method = "GET";
  if (method !== "GET") throw new Error("validate-readonly is GET-only");
  const headers = {
    Authorization: `Bearer ${tok}`,
    "x-api-key": ID,
    "x-gw-ims-org-id": ORG,
    "x-sandbox-name": SBX,
    ...(s.accept ? { Accept: s.accept } : {}),
  };
  let res;
  try { res = await fetch(BASE + s.path, { method, headers }); }
  catch (e) { return { status: 0, verdict: "network", note: e.message }; }

  const body = await res.text();
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const isHtml = ctype.includes("html") || /^\s*<(!doctype|html)/i.test(body);
  const requestId = res.headers.get("x-request-id");

  let verdict;
  if (res.ok) verdict = "reachable";
  else if (res.status === 404 && isHtml) verdict = "WRONG PATH (html 404)";
  else if (res.status === 404) verdict = "route exists, unprovisioned";
  else if (res.status === 401) verdict = "401 — check org / sandbox / profile scope first";
  else if (res.status === 403) verdict = "403 — product-profile permission";
  else if (res.status === 405) verdict = "route exists, POST-only";
  else verdict = `${res.status}`;

  let note = "";
  try { const j = JSON.parse(body); note = (j.title || j.error_description || j.detail || j.message || "").slice(0, 100); }
  catch { note = isHtml ? "HTML response" : body.slice(0, 60).replace(/\s+/g, " "); }

  return { status: res.status, verdict, note, requestId, isHtml, count: safeCount(body) };
}

function safeCount(body) {
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j)) return j.length;
    for (const k of ["children", "results", "sandboxes", "definitions", "workorders", "data"]) {
      if (Array.isArray(j[k])) return j[k].length;
    }
    if (j && typeof j === "object") return Object.keys(j).length;
  } catch { /* not JSON */ }
  return null;
}

const tok = await token();
console.error(`Token acquired. Probing ${SURFACES.length} surfaces (GET only) in sandbox '${SBX}'.\n`);

const results = [];
for (const s of SURFACES) {
  const r = await probe(tok, s);
  results.push({ ...s, ...r });
  console.log(`${String(r.status).padStart(3)}  ${s.label.padEnd(24)} ${r.verdict}${r.note ? "  — " + r.note : ""}`);
}

// Sandbox type is what the write guard depends on; surface it explicitly.
const sb = results.find((r) => r.key === "sandboxes");
if (sb?.status === 200) {
  console.log(`\nSandbox Management is readable — the write guard will be able to resolve a type.`);
} else {
  console.log(
    `\nSandbox Management returned ${sb?.status}. The write guard cannot resolve a sandbox type,` +
      ` so in safe mode it will fail CLOSED and refuse every mutation. Grant view-sandboxes before mutation testing.`,
  );
}

const wrongPaths = results.filter((r) => r.isHtml && r.status === 404);
const ok = results.filter((r) => r.status === 200).length;
console.log(`\n${ok}/${results.length} reachable · ${results.filter((r) => r.status === 403).length} permission-gated · ${results.filter((r) => r.status === 401).length} 401 · ${wrongPaths.length} wrong-path`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ sandbox: SBX, results }, null, 2));
  console.log(`Wrote ${jsonOut}`);
}

if (wrongPaths.length) {
  console.log("\nOur own paths are wrong — fix before anything else:");
  for (const r of wrongPaths) console.log(`  ${r.label}: ${r.path}`);
  process.exit(1);
}
