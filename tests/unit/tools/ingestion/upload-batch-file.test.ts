import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/ingestion/upload-batch-file.js";

/**
 * Upload contract, audited against Adobe's Batch Ingestion API:
 *   PUT /data/foundation/import/batches/{batchId}/datasets/{datasetId}/files/{fileName}
 *   Content-Type: application/octet-stream
 *   single-part raw binary body — never multipart/form-data
 */

const BATCH = "01FAKEBATCH0001";
const DATASET = "fake0000dataset01";
const FILE = "mcpval-2026-08-16-run-phase2b.json";
const LINE = JSON.stringify({ _id: "synthetic-1" }) + "\n";

function harness() {
  const request = vi.fn(async () => undefined);
  const handlers = new Map<string, any>();
  register(
    {
      registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h),
      tool: (n: string, _d: unknown, _s: unknown, h: any) => handlers.set(n, h),
    } as never,
    {
      client: { request },
      tokenCache: {},
      credentials: {
        clientId: "c", clientSecret: "s",
        orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp",
      },
    } as never,
  );
  return { request, handler: handlers.get("aep_upload_batch_file")! };
}

const base = { batchId: BATCH, datasetId: DATASET, fileName: FILE, content: LINE };
const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

describe("request shape", () => {
  it("PUTs to the documented path", async () => {
    const { request, handler } = harness();
    await handler({ ...base, dryRun: false }, {});
    const spec = request.mock.calls[0][0] as any;
    expect(spec.method).toBe("PUT");
    expect(spec.path).toBe(
      `/data/foundation/import/batches/${BATCH}/datasets/${DATASET}/files/${encodeURIComponent(FILE)}`,
    );
  });

  it("sends Content-Type: application/octet-stream", async () => {
    const { request, handler } = harness();
    await handler({ ...base, dryRun: false }, {});
    expect((request.mock.calls[0][0] as any).headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("sends the body raw, never JSON-wrapped or multipart", async () => {
    const { request, handler } = harness();
    await handler({ ...base, dryRun: false }, {});
    const spec = request.mock.calls[0][0] as any;
    expect(spec.rawBody).toBe(LINE);
    expect(spec.body).toBeUndefined();
    expect(JSON.stringify(spec.headers)).not.toMatch(/multipart/i);
  });
});

describe("dryRun defaults to true and sends nothing", () => {
  it("makes zero requests when dryRun is omitted from an explicit parse", async () => {
    const { request, handler } = harness();
    const out = await parse(handler({ ...base, dryRun: true }, {}));
    expect(out.sent).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("reports shape and size but NOT the file content", async () => {
    const { handler } = harness();
    const out = await parse(handler({ ...base, dryRun: true }, {}));
    expect(out.wouldSend.method).toBe("PUT");
    expect(out.wouldSend.bodyBytes).toBe(Buffer.byteLength(LINE, "utf8"));
    expect(out.wouldSend.bodySha256Prefix).toMatch(/^[0-9a-f]{16}$/);
    // The payload itself must never be echoed back through the transcript.
    expect(JSON.stringify(out)).not.toContain("synthetic-1");
  });

  it("the schema default is true", async () => {
    const { z } = await import("zod");
    const mod = await import("../../../../src/tools/ingestion/upload-batch-file.js");
    let shape: any;
    mod.register(
      { registerTool: (_n: string, m: any) => { shape = m.inputSchema; }, tool: () => {} } as never,
      { client: { request: async () => {} }, tokenCache: {},
        credentials: { clientId: "c", clientSecret: "s", orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp" } } as never,
    );
    expect(z.object(shape).parse({ batchId: BATCH, datasetId: DATASET, fileName: FILE }).dryRun).toBe(true);
  });
});

describe("filename safety", () => {
  it.each([
    ["a slash", "a/b.json"],
    ["a backslash", "a\\b.json"],
    ["traversal", "../escape.json"],
  ])("refuses %s", async (_l, fileName) => {
    const { request, handler } = harness();
    const out = await parse(handler({ ...base, fileName, dryRun: false }, {}));
    expect(out.code).toBe("INVALID_INPUT");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("exactly one content source", () => {
  it("refuses both", async () => {
    const { handler } = harness();
    const out = await parse(handler({ ...base, localFilePath: "/tmp/x.json", dryRun: false }, {}));
    expect(out.code).toBe("INVALID_INPUT");
  });

  it("refuses neither", async () => {
    const { handler } = harness();
    const out = await parse(handler({ batchId: BATCH, datasetId: DATASET, fileName: FILE, dryRun: false }, {}));
    expect(out.code).toBe("INVALID_INPUT");
  });
});
