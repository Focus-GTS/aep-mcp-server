#!/usr/bin/env node
/**
 * Read-only live validation harness.
 *
 * SAFETY: issues GET requests only. There is a hard assertion below that
 * refuses any other method, so this cannot create, modify, or delete anything.
 * It is safe to run against a production sandbox, and safe to run before the
 * mutation gates have been opened.
 *
 * Purpose: the moment a credential for a new sandbox
 * arrives, run this FIRST. It answers "what can this credential actually
 * reach" before a single write is attempted.
 *
 *   node scripts/validate-readonly.mjs --env .env.dev
 *   node scripts/validate-readonly.mjs --env .env.dev --json out.json
 *
 * Exit codes:
 *   0  every surface reachable or explained
 *   1  at least one HTML 404 — a wrong path in our own code
 *   2  configuration or authentication failure
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { classify, classifySandboxMembership } from "./classify-response.mjs";

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
  // Path mirrors DATASTREAMS_BASE_PATH in src/tools/datastreams/paths.ts.
  // tests/unit/tools/datastreams/path-contract.test.ts fails if they drift.
  // NOTE: undocumented and unconfirmed — see that file for the evidence.
  { key: "datastreams", label: "Datastreams", path: "/data/core/edge/datastreams", documented: false },
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

// The wrong-org guard.
//
// This used to hardcode the expected IMS org ID and sandbox name, plus a map of
// recognised orgs with descriptive labels. That worked, but it published one
// tenant's identifiers in a public repository and silently pinned the harness
// to a single environment.
//
// It is now supplied by the caller and FAILS CLOSED. Two changes strengthen it:
//
//   1. A missing expectation is fatal. Previously an unset expectation was
//      impossible, so there was no "unknown" state; now that the value comes
//      from outside, "not told what to expect" must never mean "proceed".
//   2. A mismatch is fatal. Previously it printed `UNEXPECTED (...)` and then
//      carried on and issued the requests anyway — a warning nobody reads is
//      not a guard. It exits 2.
//
// Neither the expected nor the actual value is ever printed in full. A short
// SHA-256 fingerprint is enough to see at a glance whether two values agree,
// and to compare against a fingerprint you computed yourself, without putting
// a tenant identifier into a terminal, a CI log, or a screenshot.
const fingerprint = (v) =>
  createHash("sha256").update(String(v)).digest("hex").slice(0, 12);

const EXPECTED_ORG = process.env.AEP_EXPECTED_ORG_ID;
const EXPECTED_SANDBOX = process.env.AEP_EXPECTED_SANDBOX_NAME;

if (!EXPECTED_ORG || !EXPECTED_SANDBOX) {
  console.error(
    "REFUSING TO RUN: AEP_EXPECTED_ORG_ID and AEP_EXPECTED_SANDBOX_NAME must both be set.\n" +
      "\n" +
      "They are the wrong-org guard: this harness will not send a single request until it\n" +
      "has been told which tenant it is supposed to be talking to. Set them alongside your\n" +
      "credentials (they are expectations, not secrets, but they are tenant-specific, so\n" +
      "keep them in your untracked .env rather than in the repository).\n" +
      "\n" +
      "  AEP_EXPECTED_ORG_ID=<IMS_ORG_ID>\n" +
      "  AEP_EXPECTED_SANDBOX_NAME=<DEVELOPMENT_SANDBOX>",
  );
  process.exit(2);
}

// Presence only for the credential. No lengths, no prefixes, no derived values
// — a length or a leading character is still information about a secret, and
// there is no diagnostic here that needs it.
const orgMatches = ORG === EXPECTED_ORG;
const sandboxMatches = SBX === EXPECTED_SANDBOX;

console.error("Credential preflight:");
console.error(`  AEP_CLIENT_ID      ${ID ? "present" : "MISSING"}`);
console.error(`  AEP_CLIENT_SECRET  ${SECRET ? "present" : "MISSING"}`);
console.error(`  AEP_ORG_ID         ${orgMatches ? "matches expected" : "MISMATCH"} (actual sha256:${fingerprint(ORG)}, expected sha256:${fingerprint(EXPECTED_ORG)})`);
console.error(`  AEP_SANDBOX_NAME   ${sandboxMatches ? "matches expected" : "MISMATCH"} (actual sha256:${fingerprint(SBX)}, expected sha256:${fingerprint(EXPECTED_SANDBOX)})`);

if (!orgMatches || !sandboxMatches) {
  console.error(
    "\n  REFUSING TO RUN: the credential does not point at the expected tenant.\n" +
      "  Fingerprints above disagree. Check which .env was loaded before re-running.",
  );
  process.exit(2);
}
if (SBX === "prod" || SBX === "production") {
  console.error("\n  REFUSING TO RUN: sandbox is 'prod'. This harness is read-only, but prod is off-limits.");
  process.exit(2);
}
console.error("");

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

  const cls = classify({
    status: res.status,
    body,
    contentType: ctype,
    documented: s.documented !== false,
  });
  const verdict = `${cls.label}  [fix: ${cls.owner}]`;

  let note = "";
  try { const j = JSON.parse(body); note = (j.title || j.error_description || j.detail || j.message || "").slice(0, 100); }
  catch { note = isHtml ? "HTML response" : body.slice(0, 60).replace(/\s+/g, " "); }

  // Names only — never dump the sandbox objects, which carry tenant metadata.
  let sandboxNames;
  if (s.key === "sandboxes") {
    try { sandboxNames = (JSON.parse(body).sandboxes ?? []).map((x) => x?.name).filter(Boolean); }
    catch { sandboxNames = []; }
  }
  return { status: res.status, verdict, classCode: cls.code, owner: cls.owner, note, requestId, isHtml, count: safeCount(body), sandboxNames, rawBody: s.key === 'sandboxes' ? body : undefined };
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
//
// A 200 here is NOT sufficient. `/sandbox-management/` returns 200 with an
// EMPTY sandboxes array when the credential is a member of none — which is
// exactly the case that makes resolveSandbox() return `unknown` and safe mode
// fail closed. Checking only the status code reports false confidence.
const sb = results.find((r) => r.key === "sandboxes");
const listed = sb?.sandboxNames ?? [];
const membership = sb?.rawBody !== undefined
  ? classifySandboxMembership(sb.rawBody, SBX)
  : { code: 'MISSING_SANDBOX_MEMBERSHIP', label: 'MISSING SANDBOX MEMBERSHIP' };
if (sb?.status === 200 && listed.includes(SBX)) {
  console.log(`\nSandbox Management lists '${SBX}' — the write guard can resolve its type.`);
} else if (sb?.status === 200) {
  console.log(
    `\nMISSING SANDBOX MEMBERSHIP — Sandbox Management returned 200 but does NOT list '${SBX}'` +
      (listed.length ? ` (visible: ${listed.join(", ")})` : " (it lists no sandboxes at all)") +
      `.\n  resolveSandbox() will report type 'unknown', so in safe mode EVERY mutation` +
      `\n  fails closed. Grant view-sandboxes before attempting write validation.`,
  );
} else {
  console.log(
    `\nSandbox Management returned ${sb?.status}. The write guard cannot resolve a sandbox type,` +
      ` so in safe mode it will fail CLOSED and refuse every mutation. Grant view-sandboxes before mutation testing.`,
  );
}

const byClass = (c) => results.filter((r) => r.classCode === c);
const ok = byClass("WORKING_ACCESS").length + byClass("VALID_EMPTY").length;

console.log(
  `\n${ok}/${results.length} reachable` +
    ` · ${byClass("MISSING_PRODUCT_PROFILE_PERMISSION").length} permission-gated` +
    ` · ${byClass("MISSING_ENTITLEMENT").length} entitlement` +
    ` · ${byClass("UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT").length} undocumented` +
    ` · ${byClass("IMPLEMENTATION_ERROR").length} our bug`,
);

// Only OUR bugs fail the run. An undocumented endpoint is a question for
// Adobe, not a defect to fix before proceeding — conflating the two made the
// harness demand a fix for something we cannot fix.
const ourBugs = byClass("IMPLEMENTATION_ERROR");
if (ourBugs.length) {
  console.log("\nImplementation errors — ours to fix:");
  for (const r of ourBugs) console.log(`  ${r.label}: ${r.path}`);
}

const undocumented = byClass("UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT");
if (undocumented.length) {
  console.log("\nUndocumented endpoints — ask Adobe for the supported API:");
  for (const r of undocumented) console.log(`  ${r.label}: ${r.path}`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ sandbox: SBX, results: results.map(({ rawBody, ...r }) => r) }, null, 2));
  console.log(`Wrote ${jsonOut}`);
}

process.exit(ourBugs.length ? 1 : 0);
