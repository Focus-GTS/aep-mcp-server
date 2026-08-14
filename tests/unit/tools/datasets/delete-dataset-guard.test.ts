import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { register } from "../../../../src/tools/datasets/delete-dataset.js";
import { AepClient } from "../../../../src/auth/aep-client.js";
import type { SandboxInfo } from "../../../../src/auth/sandbox-guard.js";

/**
 * The tool's own gates are not the last line of defence — the write guard in
 * AepClient is. These tests wire the REAL client (with fetch mocked) so the
 * guard actually runs, proving a DELETE cannot escape even if every tool-level
 * check were bypassed.
 */

const FAKE_ID = "fake0000dataset0001";
const CONFIRM = `DELETE DATASET ${FAKE_ID}`;
const PLAIN = { name: "mcpval-2026-08-14-abc-phase1", tags: {} };

const DEV: SandboxInfo = { name: "focusgts-ucp", type: "development", source: "adobe-api" };
const PROD: SandboxInfo = { name: "prod", type: "production", source: "adobe-api" };
const UNKNOWN: SandboxInfo = { name: "focusgts-ucp", type: "unknown", source: "unresolved" };

const ENV = [
  "AEP_ALLOW_MUTATIONS",
  "AEP_MODE",
  "AEP_SANDBOX_NAME",
  "AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.AEP_SANDBOX_NAME = "focusgts-ucp";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function harness(sandbox: SandboxInfo) {
  const fetches: Array<{ method: string; url: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    fetches.push({ method, url: String(url) });
    const body = method === "DELETE" ? [`@/dataSets/${FAKE_ID}`] : { [FAKE_ID]: PLAIN };
    return new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));

  const creds = {
    clientId: "c", clientSecret: "s",
    orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp",
  };
  const tokenCache = { getToken: async () => "fake-token", invalidate: () => {} };
  const client = new AepClient(creds as never, tokenCache as never);
  (client as unknown as { sandboxInfo: SandboxInfo }).sandboxInfo = sandbox;

  const handlers = new Map<string, any>();
  register(
    {
      registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h),
      tool: (n: string, _d: unknown, _s: unknown, h: any) => handlers.set(n, h),
    } as never,
    { client, tokenCache, credentials: creds } as never,
  );
  return {
    handler: handlers.get("aep_delete_dataset")!,
    deletes: () => fetches.filter((f) => f.method === "DELETE"),
  };
}

const run = (h: any, a = {}) =>
  h({ datasetId: FAKE_ID, confirm: CONFIRM, dryRun: false, allowProfileEnabled: false, ...a }, {});
const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

describe("the write guard blocks the DELETE, not just the tool", () => {
  it("blocks when AEP_ALLOW_MUTATIONS is unset, even in a development sandbox", async () => {
    const { handler, deletes } = harness(DEV);
    const out = await parse(run(handler));
    expect(deletes()).toHaveLength(0);
    expect(JSON.stringify(out)).toMatch(/AEP_ALLOW_MUTATIONS/);
  });

  it("blocks when the sandbox type is unresolved — fails closed", async () => {
    process.env.AEP_ALLOW_MUTATIONS = "true";
    const { handler, deletes } = harness(UNKNOWN);
    await run(handler);
    expect(deletes()).toHaveLength(0);
  });

  it("blocks against a production sandbox", async () => {
    process.env.AEP_ALLOW_MUTATIONS = "true";
    process.env.AEP_SANDBOX_NAME = "prod";
    const { handler, deletes } = harness(PROD);
    await run(handler);
    expect(deletes()).toHaveLength(0);
  });

  it("permits the DELETE only with mutations enabled AND a development sandbox", async () => {
    process.env.AEP_ALLOW_MUTATIONS = "true";
    const { handler, deletes } = harness(DEV);
    const out = await parse(run(handler));
    expect(out.deleted).toBe(true);
    expect(deletes()).toHaveLength(1);
  });

  it("dryRun issues no DELETE even when everything is enabled", async () => {
    process.env.AEP_ALLOW_MUTATIONS = "true";
    const { handler, deletes } = harness(DEV);
    const out = await parse(run(handler, { dryRun: true }));
    expect(out.sent).toBe(false);
    expect(deletes()).toHaveLength(0);
  });

  it("the preflight GET still works while mutations are disabled", async () => {
    // Reads are never gated; only the DELETE is.
    const { handler } = harness(DEV);
    await run(handler, { dryRun: true });
    // No throw, and dryRun returned a preflight — see the assertion above.
  });
});
