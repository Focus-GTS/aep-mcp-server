import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../../../src/types/context.js";
import { register } from "../../../../src/tools/profiles/delete-profile.js";

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

  const requestMock = vi.fn();
  const mockCtx = {
    client: { request: requestMock },
  } as unknown as ToolContext;

  register(mockServer, mockCtx);

  if (calls.length !== 1) {
    throw new Error(`Expected exactly 1 tool registration, got ${calls.length}`);
  }

  return { handler: calls[0].handler, requestMock, registered: calls[0] };
}

function parseErrorPayload(result: {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}): { code: string; message: string; details?: unknown } {
  return JSON.parse(result.content[0].text);
}

describe("aep_delete_profile confirmation gate", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("registers as aep_delete_profile", () => {
    expect(ctx.registered.name).toBe("aep_delete_profile");
  });

  it("rejects with CONFIRMATION_REQUIRED when confirm is wrong text", async () => {
    const result = await ctx.handler({
      entityId: "user-123@example.com",
      entityIdNS: "email",
      confirm: "wrong text",
    });

    expect(result.isError).toBe(true);
    const payload = parseErrorPayload(result);
    expect(payload.code).toBe("CONFIRMATION_REQUIRED");
    expect(ctx.requestMock).not.toHaveBeenCalled();
  });

  it("calls ctx.client.request with correct method, endpoint, and query when confirm matches", async () => {
    ctx.requestMock.mockResolvedValueOnce({ jobId: "job-xyz" });

    const result = await ctx.handler({
      entityId: "user-123@example.com",
      entityIdNS: "email",
      confirm: CONFIRMATION_PHRASE,
    });

    expect(ctx.requestMock).toHaveBeenCalledTimes(1);
    expect(ctx.requestMock).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/data/core/ups/access/entities",
      query: {
        entityId: "user-123@example.com",
        entityIdNS: "email",
        "schema.name": "_xdm.context.profile",
      },
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.jobId).toBe("job-xyz");
  });

  it("rejects with CONFIRMATION_REQUIRED when confirm is undefined", async () => {
    const result = await ctx.handler({
      entityId: "user-123@example.com",
      entityIdNS: "email",
      confirm: undefined,
    });

    expect(result.isError).toBe(true);
    const payload = parseErrorPayload(result);
    expect(payload.code).toBe("CONFIRMATION_REQUIRED");
    expect(ctx.requestMock).not.toHaveBeenCalled();
  });
});
