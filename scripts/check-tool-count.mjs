#!/usr/bin/env node
/**
 * One number, six places. This makes the registry the only source of truth for
 * it and fails the build when anything disagrees.
 *
 * The tool count is duplicated across package.json, server.json, the README,
 * the validation matrix and the GitHub repository description. It has now
 * drifted TWICE:
 *
 *   0.8.0  every surface said 46 while the registry held 53
 *   0.10.0 the GitHub About said 53 while the registry held 51
 *
 * Both times the fix was manual, and both times a surface was missed — because
 * nobody can hold six places in their head across a release. A test already
 * keeps the README's tool NAMES honest; this covers the COUNTS, including the
 * one surface that lives outside the repository entirely.
 *
 *   node scripts/check-tool-count.mjs            # local, checks GitHub too if gh is authed
 *   node scripts/check-tool-count.mjs --no-remote  # repo files only (CI without gh)
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const skipRemote = process.argv.includes("--no-remote");

const { registerAllTools } = await import("../dist/tools/index.js");
const names = [];
registerAllTools(
  { registerTool: (n) => names.push(n), tool: (n) => names.push(n) },
  { client: {}, tokenCache: {}, credentials: { clientId: "x", clientSecret: "y", orgId: "z@AdobeOrg", sandboxName: "dev" } },
);
const TRUTH = names.length;
const CATEGORIES = new Set(
  names.map((n) => (n.startsWith("ajo_") ? "ajo" : n.split("_")[1])),
).size; // informational only; the assertion below is on the tool count

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const checks = [];

/** Pull every "<n> tools" claim out of a blob and assert each equals TRUTH. */
function claim(label, text, re) {
  // Alternation groups mean the number can land in any capture slot.
  const found = [...text.matchAll(re)].map((m) => Number(m.slice(1).find((x) => x !== undefined)));
  if (found.length === 0) { checks.push({ label, ok: false, detail: "no tool-count claim found — did the wording change?" }); return; }
  const wrong = found.filter((n) => n !== TRUTH);
  checks.push({ label, ok: wrong.length === 0, detail: wrong.length ? `claims ${[...new Set(wrong)].join(", ")}` : `${found.length} claim(s) all ${TRUTH}` });
}

claim("package.json description", JSON.parse(read("package.json")).description, /(\d+) tools/g);
claim("server.json description", JSON.parse(read("server.json")).description, /(\d+) tools/g);
// The README legitimately contains PER-CATEGORY counts ("7 tools", "9 tools")
// in the comparison table, so a bare /(\d+) tools/ matches those too and
// reports a failure that is not one. This guard's own first run did exactly
// that. Match only the phrasings that assert the TOTAL.
claim("README.md", read("README.md"), /(\d+) tools across \d+ categories/g);
claim("README.md headings", read("README.md"), /The (\d+) tools|<b>(\d+) tools<\/b>|aep-mcp-server<br\/>(\d+) tools|aep-mcp-server — (\d+) tools|all (\d+) inherit it/g);
claim("docs/VALIDATION-MATRIX.md", read("docs/VALIDATION-MATRIX.md"), /Status of all (\d+) tools/g);

if (!skipRemote) {
  try {
    const desc = execSync("gh repo view --json description -q .description", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    claim("GitHub About (remote)", desc, /(\d+) tools/g);
  } catch {
    checks.push({ label: "GitHub About (remote)", ok: true, detail: "skipped — gh unavailable or unauthenticated" });
  }
}

console.log(`registry: ${TRUTH} tools (${CATEGORIES} prefixes/categories)\n`);
for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.label.padEnd(30)} ${c.detail}`);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} surface(s) disagree with the registry.`);
  console.error("The registry is the source of truth. Update the others — including the GitHub");
  console.error("description, which is not in the repo and so is the one people forget.");
  process.exit(1);
}
console.log("\nall surfaces agree.");
