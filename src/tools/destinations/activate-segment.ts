import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_activate_segment";
const TOOL_DESCRIPTION =
  "Activate a segment (audience) to a pre-configured destination connection in the Adobe Experience " +
  "Platform Flow Service. Creates a new activation flow linking the segment to the destination. " +
  "PREREQUISITE: the destination connection (destinationConnectionId) must already exist — create it via " +
  "the AEP Destinations UI or the connections API before calling this tool. " +
  "Optionally accepts a flow name and a schedule (frequency + startTime). " +
  "Returns the created flow's id and status.";

const scheduleSchema = z
  .object({
    frequency: z
      .enum(["once", "hourly", "daily"])
      .describe("Activation cadence"),
    startTime: z
      .string()
      .datetime()
      .optional()
      .describe("Optional ISO-8601 timestamp for the first activation run"),
  })
  .optional()
  .describe("Optional activation schedule");

const inputSchema = {
  segmentId: z
    .string()
    .min(1)
    .describe("ID of the segment to activate"),
  destinationConnectionId: z
    .string()
    .min(1)
    .describe(
      "ID of the pre-configured destination connection that this segment should be sent to. " +
        "This connection must already exist in AEP.",
    ),
  name: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("Optional human-readable name for the activation flow"),
  schedule: scheduleSchema,
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { segmentId, destinationConnectionId, name, schedule } = args;

    try {
      logger.debug(
        { tool: TOOL_NAME, segmentId, destinationConnectionId, schedule },
        "Activating segment to destination",
      );

      const flowName = name ?? `Activate ${segmentId} -> ${destinationConnectionId}`;

      const scheduleParams: Record<string, unknown> | undefined = schedule
        ? {
            frequency: schedule.frequency,
            ...(schedule.startTime ? { startTime: schedule.startTime } : {}),
          }
        : undefined;

      const body: Record<string, unknown> = {
        name: flowName,
        sourceConnectionIds: [],
        targetConnectionIds: [destinationConnectionId],
        transformations: [
          {
            name: "Mapping",
            params: {
              segmentSelectors: {
                selectors: [
                  {
                    type: "PLATFORM_SEGMENT",
                    value: {
                      id: segmentId,
                    },
                  },
                ],
              },
            },
          },
        ],
        ...(scheduleParams ? { scheduleParams } : {}),
      };

      const created = await ctx.client.request<{ id: string; status?: string }>({
        method: "POST",
        path: "/data/foundation/flowservice/flows",
        body,
      });

      logger.info(
        { tool: TOOL_NAME, flowId: created.id, segmentId, destinationConnectionId },
        "Segment activation flow created",
      );

      return toolResult({
        flowId: created.id,
        status: created.status ?? "CREATED",
        segmentId,
        destinationConnectionId,
        name: flowName,
      });
    } catch (err) {
      logger.error(
        { tool: TOOL_NAME, segmentId, destinationConnectionId, err },
        "Failed to activate segment",
      );
      return toolError(mapApiError(err));
    }
  });
}
