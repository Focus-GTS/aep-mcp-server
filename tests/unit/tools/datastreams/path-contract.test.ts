import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DATASTREAMS_BASE_PATH,
  datastreamPath,
} from "../../../../src/tools/datastreams/paths.js";

/**
 * Contract tests that would have caught the 2026-08-12 HTML 404 before it
 * reached a live tenant.
 *
 * The actual defect was NOT a bad path in a tool. It was a *disagreement*:
 * scripts/validate-readonly.mjs probed `/data/foundation/edge/datastreams`
 * while every tool used `/data/core/edge/datastreams`. The probe therefore
 * validated a path no tool uses, and its failure said nothing about the tools.
 *
 * No mock-response test would have found that — both sides were internally
 * consistent. Only an agreement check across the boundary finds it.
 */

const SRC = "src";
const PROBE_SCRIPT = "scripts/validate-readonly.mjs";

/** Every AEP path literal in the source tree, with its file. */
function collectPaths(): Array<{ file: string; path: string }> {
  const out: Array<{ file: string; path: string }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith(".ts")) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/["'`](\/data\/[A-Za-z0-9/_${}.-]*)["'`]/g)) {
          out.push({ file: p, path: m[1] });
        }
      }
    }
  };
  walk(SRC);
  return out;
}

describe("datastream path is defined in exactly one place", () => {
  it("no tool hardcodes the datastream path", () => {
    const offenders = collectPaths().filter(
      (x) => x.path.includes("edge/datastreams") && !x.file.endsWith("paths.ts"),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("builds a single-resource path from the base", () => {
    expect(datastreamPath("abc123")).toBe(`${DATASTREAMS_BASE_PATH}/abc123`);
  });

  it("does not double the separator", () => {
    expect(datastreamPath("x")).not.toContain("//");
  });
});

describe("the read-only probe and the tools cannot disagree", () => {
  it("the probe uses the same datastream path the tools use", () => {
    // The exact check that was missing. The probe had `/data/foundation/...`
    // while the tools had `/data/core/...`, and nothing noticed.
    const probe = readFileSync(PROBE_SCRIPT, "utf8");
    const datastreamLine = probe
      .split("\n")
      .find((l) => l.includes("datastreams") && l.includes("path:"));

    expect(datastreamLine, "probe has no datastream surface").toBeDefined();
    expect(datastreamLine).toContain(DATASTREAMS_BASE_PATH);
  });

  it("the probe references no /data/ path absent from the source tree", () => {
    const probe = readFileSync(PROBE_SCRIPT, "utf8");
    const probePaths = [...probe.matchAll(/["'`](\/data\/[A-Za-z0-9/_-]+)/g)].map(
      (m) => m[1],
    );
    const sourceText = collectPaths()
      .map((x) => x.path)
      .join("\n");

    // Compare on the first three segments: /data/<area>/<service>. A typo in
    // any of them is the class of error that produces an HTML 404.
    const prefix = (p: string) => p.split("/").slice(0, 4).join("/");
    const sourcePrefixes = new Set(
      sourceText.split("\n").map(prefix).filter(Boolean),
    );

    const orphans = [...new Set(probePaths.map(prefix))].filter(
      (p) => !sourcePrefixes.has(p),
    );
    expect(
      orphans,
      "probe targets a service prefix no tool uses — one of them is wrong",
    ).toEqual([]);
  });
});

describe("AEP path shape", () => {
  const KNOWN_AREAS = new Set(["foundation", "core"]);

  it("every /data/ path uses a known AEP area segment", () => {
    // `/data/foundation/...` and `/data/core/...` are the two real areas.
    // `/data/edge/...` or a misspelling would be caught here.
    const bad = collectPaths().filter((x) => {
      const area = x.path.split("/")[2];
      return area && !KNOWN_AREAS.has(area);
    });
    expect(bad.map((b) => `${b.file}: ${b.path}`)).toEqual([]);
  });

  it("no path has a doubled or trailing slash", () => {
    const bad = collectPaths().filter(
      (x) => x.path.includes("//") || (x.path.length > 1 && x.path.endsWith("/") && !x.path.endsWith("sandbox-management/")),
    );
    expect(bad.map((b) => `${b.file}: ${b.path}`)).toEqual([]);
  });

  it("no path contains an unresolved template placeholder", () => {
    // e.g. a literal "{id}" left in place of a real interpolation.
    const bad = collectPaths().filter((x) => /\{[a-z_]+\}/i.test(x.path) && !x.path.includes("${"));
    expect(bad.map((b) => `${b.file}: ${b.path}`)).toEqual([]);
  });
});

describe("documentation status is recorded, not assumed", () => {
  it("paths.ts states that the datastream path is unverified", () => {
    // This path is not supported by Adobe documentation and has never been
    // confirmed live. If someone deletes that caveat, they should have to
    // delete this test too and think about why.
    const src = readFileSync("src/tools/datastreams/paths.ts", "utf8");
    expect(src).toMatch(/UNVERIFIED/);
    expect(src).toMatch(/not\s+documentation-supported/i);
  });
});

describe("datastream tools declare their unverified status to callers", () => {
  it("every datastream tool description carries the caveat", () => {
    // The caveat belongs in the DESCRIPTION, not just a doc file: that is what
    // an agent and an operator actually see in tools/list before calling.
    const dir = "src/tools/datastreams";
    const tools = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !["index.ts", "paths.ts"].includes(f),
    );
    expect(tools.length).toBe(5);
    for (const f of tools) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, `${f} missing caveat`).toMatch(/ENDPOINT UNDOCUMENTED/);
      expect(src, `${f} missing case reference`).toMatch(/SALES0855734/);
    }
  });
});
