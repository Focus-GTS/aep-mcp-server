import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../../../src/types/context.js";
import { register } from "../../../../src/tools/hygiene/create-record-delete.js";

const CONFIRMATION_PHRASE = "I understand this is irreversible";

interface CapturedCall {
  name: string;
  description: string;
  schema: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<any>;
}

function setup() {
  const calls: CapturedCall[] = [];
  const mockServer = {
    tool: (
      name: string,
      description: string,
      schema: unknown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (args: any) => Promise<any>,
    ) => {
      calls.push({ name, description, schema, handler });
    },
  } as unknown as McpServer;

  // The tool calls client.post(); request() is mocked too so that a future
  // refactor to request() still exercises a defined method rather than
  // throwing a confusing TypeError.
  const postMock = vi.fn();
  const requestMock = vi.fn();
  const mockCtx = {
    client: { post: postMock, request: requestMock },
  } as unknown as ToolContext;

  register(mockServer, mockCtx);

  if (calls.length !== 1) {
    throw new Error(`Expected exactly 1 tool registration, got ${calls.length}`);
  }

  return {
    handler: calls[0].handler,
    postMock,
    requestMock,
    registered: calls[0],
    /** True when the tool hit the API by any path. */
    apiWasCalled: () =>
      postMock.mock.calls.length + requestMock.mock.calls.length > 0,
  };
}

function parsePayload(result: {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

const VALID_IDENTITIES = [{ namespace: "email", id: "user@example.com" }];

describe("aep_create_record_delete confirmation gate", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("registers as aep_create_record_delete", () => {
    expect(ctx.registered.name).toBe("aep_create_record_delete");
  });

  it("advertises itself as destructive in its description", () => {
    expect(ctx.registered.description).toContain("DESTRUCTIVE");
  });

  it("rejects when confirm is wrong text, WITHOUT calling the API", async () => {
    const result = await ctx.handler({
      datasetId: "ALL",
      identities: VALID_IDENTITIES,
      confirm: "yes please",
    });

    expect(result.isError).toBe(true);
    expect(parsePayload(result).code).toBe("CONFIRMATION_REQUIRED");
    expect(ctx.apiWasCalled()).toBe(false);
  });

  it("rejects when confirm is omitted, WITHOUT calling the API", async () => {
    const result = await ctx.handler({
      datasetId: "ALL",
      identities: VALID_IDENTITIES,
      confirm: undefined,
    });

    expect(result.isError).toBe(true);
    expect(parsePayload(result).code).toBe("CONFIRMATION_REQUIRED");
    expect(ctx.apiWasCalled()).toBe(false);
  });

  it("rejects on a near-miss phrase (exact match required)", async () => {
    const result = await ctx.handler({
      datasetId: "ALL",
      identities: VALID_IDENTITIES,
      confirm: "I understand this is irreversible.", // trailing period
    });

    expect(result.isError).toBe(true);
    expect(parsePayload(result).code).toBe("CONFIRMATION_REQUIRED");
    expect(ctx.apiWasCalled()).toBe(false);
  });

  it("proceeds to the API only when the phrase matches exactly", async () => {
    ctx.postMock.mockResolvedValueOnce({ workorderId: "wo-123" });

    const result = await ctx.handler({
      datasetId: "ALL",
      identities: VALID_IDENTITIES,
      confirm: CONFIRMATION_PHRASE,
    });

    expect(ctx.postMock).toHaveBeenCalledTimes(1);
    const [path] = ctx.postMock.mock.calls[0];
    expect(path).toContain("/data/core/hygiene/workorder");
    expect(result.isError).toBeFalsy();
  });
});
