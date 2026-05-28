import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Segment } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_create_segment";
const TOOL_DESCRIPTION =
  "Create a new segment definition in the Adobe Experience Platform Unified Profile Service. " +
  "Accepts a PQL expression describing the audience logic, the XDM schema class to evaluate against " +
  "(defaults to '_xdm.context.profile'), and the evaluation cadence (batch or continuous). " +
  "Returns the created Segment including its server-assigned id.";

const inputSchema = {
  name: z
    .string()
    .min(1)
    .max(255)
    .describe("Human-readable name for the segment (e.g. 'High Value Customers')"),
  description: z
    .string()
    .max(4096)
    .optional()
    .describe("Optional description of the segment's intent"),
  pqlExpression: z
    .string()
    .min(1)
    .describe(
      "The PQL (Profile Query Language) expression that defines the segment's audience logic",
    ),
  pqlFormat: z
    .enum(["pql/text", "pql/json"])
    .default("pql/text")
    .describe("Format of the PQL expression: 'pql/text' (human-readable) or 'pql/json' (AST)"),
  schemaName: z
    .string()
    .min(1)
    .default("_xdm.context.profile")
    .describe("XDM schema class the segment evaluates against (defaults to _xdm.context.profile)"),
  evaluationType: z
    .enum(["batch", "continuous"])
    .default("continuous")
    .describe(
      "Evaluation cadence: 'continuous' (streaming, near real-time) or 'batch' (scheduled)",
    ),
  ttlInDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Optional time-to-live in days for profile membership in this segment"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { name, description, pqlExpression, pqlFormat, schemaName, evaluationType, ttlInDays } =
      args;

    try {
      logger.debug(
        { tool: TOOL_NAME, name, schemaName, evaluationType, pqlFormat },
        "Creating segment",
      );

      const body: Record<string, unknown> = {
        name,
        description,
        schema: { name: schemaName },
        expression: {
          type: "PQL",
          format: pqlFormat,
          value: pqlExpression,
        },
        evaluationInfo: {
          [evaluationType]: { enabled: true },
        },
      };

      if (ttlInDays !== undefined) {
        body.ttlInDays = ttlInDays;
      }

      const created = await ctx.client.request<Segment>({
        method: "POST",
        path: "/data/core/ups/segment/definitions",
        body,
      });

      logger.info(
        { tool: TOOL_NAME, segmentId: created.id, name: created.name },
        "Segment created",
      );

      return toolResult(created);
    } catch (err) {
      logger.error({ tool: TOOL_NAME, name, err }, "Failed to create segment");
      return toolError(mapApiError(err));
    }
  });
}
