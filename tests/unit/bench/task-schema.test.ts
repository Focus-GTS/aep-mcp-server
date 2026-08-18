import { describe, it, expect } from "vitest";
// @ts-expect-error — bench is plain ESM JS, deliberately not part of the TS build
import { validateTask, TIERS } from "../../../bench/tasks/schema.mjs";
// @ts-expect-error
import tier1 from "../../../bench/tasks/tier1-read.mjs";
// @ts-expect-error
import tier2 from "../../../bench/tasks/tier2-write.mjs";

/**
 * The benchmark's credibility rests on its tasks being well-formed. A task that
 * cannot fail, or that scores itself from the agent's own tool output, is worse
 * than no task — it manufactures a green.
 */

const all = [...tier1, ...tier2];

describe("every shipped task is well-formed", () => {
  it("loads without throwing", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = all.map((t: any) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares a tier that exists", () => {
    for (const t of all as any[]) expect(TIERS[t.tier]).toBeDefined();
  });

  it("every task has an independent verify()", () => {
    for (const t of all as any[]) expect(typeof t.verify).toBe("function");
  });

  it("every tier 2+ task has cleanup()", () => {
    for (const t of (all as any[]).filter((t) => t.tier >= 2)) {
      expect(typeof t.cleanup, `${t.id} must clean up after itself`).toBe("function");
    }
  });

  it("states a goal in human terms, not tool names", () => {
    for (const t of all as any[]) {
      expect(t.goal.length).toBeGreaterThan(10);
      // A goal naming a tool is a test, not a benchmark task — it prescribes the
      // path instead of measuring whether the agent finds one.
      expect(t.goal).not.toMatch(/\baep_|\bajo_/);
    }
  });
});

describe("validateTask rejects tasks that would manufacture a pass", () => {
  const base = { id: "x", tier: 1, goal: "do a thing that matters", expectedCalls: 1, run: async () => {}, verify: async () => true };

  it("rejects a task with no verify", () => {
    expect(() => validateTask({ ...base, verify: undefined })).toThrow(/verify/);
  });

  it("rejects a tier 2 task with no cleanup", () => {
    expect(() => validateTask({ ...base, tier: 2 })).toThrow(/cleanup/);
  });

  it("rejects a bad tier", () => {
    expect(() => validateTask({ ...base, tier: 9 })).toThrow(/tier/);
  });

  it("rejects a non-positive expectedCalls", () => {
    expect(() => validateTask({ ...base, expectedCalls: 0 })).toThrow(/expectedCalls/);
  });

  it("accepts a well-formed task", () => {
    expect(() => validateTask(base)).not.toThrow();
  });
});

describe("tier metadata is honest about safety", () => {
  it("marks only tier 1 as safe on production", () => {
    expect(TIERS[1].safeOnProduction).toBe(true);
    expect(TIERS[2].safeOnProduction).toBe(false);
    expect(TIERS[3].safeOnProduction).toBe(false);
  });

  it("requires a dev sandbox for every write tier", () => {
    expect(TIERS[2].needsDevSandbox).toBe(true);
    expect(TIERS[3].needsDevSandbox).toBe(true);
  });
});
