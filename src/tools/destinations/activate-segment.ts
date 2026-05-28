import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_activate_segment";
const TOOL_DESCRIPTION =
  "Activate a segment (audience) to a pre-configured destination connection in the Adobe Experience " +
  "Platform Flow Service. Creates a new activation flow linking the customer's AEP profile source " +
  "connection to the destination connection, using the standard profile-to-destination flowSpec.\n" +
  "\n" +
  "PREREQUISITES (BOTH must already exist in AEP):\n" +
  "  1. sourceConnectionId — the customer's AEP profile source connection (typically auto-provisioned\n" +
  "     per sandbox; visible under Sources > Accounts in the AEP UI).\n" +
  "  2. destinationConnectionId — the destination connection for the target system. Create via the\n" +
  "     AEP Destinations UI or the connections API before calling this tool.\n" +
  "\n" +
  "Optionally accepts a flow name, description, and a schedule (frequency + startTime). " +
  "Returns the created flow's id and status.";

const STANDARD_PROFILE_TO_DESTINATION_FLOW_SPEC_ID =
  "71471eba-b620-49e4-90fd-23f1fa0174d8";

const scheduleSchema = z
  .object({
    frequency: z
      .enum(["minute", "hour", "day", "week", "month", "once"])
      .describe(
        "Activation cadence. Adobe-accepted values: minute, hour, day, week, month, once.",
      ),
    startTime: z
      .string()
      .datetime()
      .optional()
      .describe(
        "Optional ISO-8601 timestamp for the first activation run. " +
          "Converted to epoch SECONDS (string) before sending to Adobe.",
      ),
  })
  .optional()
  .describe("Optional activation schedule");

const inputSchema = {
  segmentId: z
    .string()
    .min(1)
    .describe("ID of the segment (audience) to activate"),
  sourceConnectionId: z
    .string()
    .min(1)
    .describe(
      "REQUIRED: ID of the pre-existing AEP profile source connection. This is the customer's " +
        "Unified Profile source connection that supplies profile data to the activation flow. " +
        "It is typically auto-provisioned per sandbox — find it under Sources > Accounts in the AEP UI.",
    ),
  destinationConnectionId: z
    .string()
    .min(1)
    .describe(
      "REQUIRED: ID of the pre-configured destination connection that this segment should be sent to. " +
        "This connection must already exist in AEP.",
    ),
  name: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("Optional human-readable name for the activation flow"),
  description: z
    .string()
    .min(1)
    .max(1000)
    .optional()
    .describe("Optional description for the activation flow"),
  schedule: scheduleSchema,
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Destinations",
        operation: "execute",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const {
        segmentId,
        sourceConnectionId,
        destinationConnectionId,
        name,
        description,
        schedule,
      } = args;

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            segmentId,
            sourceConnectionId,
            destinationConnectionId,
            schedule,
          },
          "Activating segment to destination",
        );

        const flowName =
          name ?? `Activate ${segmentId} -> ${destinationConnectionId}`;
        const flowDescription =
          description ?? `Activation flow for segment ${segmentId}`;

        // Adobe expects startTime as a STRING of epoch SECONDS (not milliseconds,
        // not a number, not ISO-8601). Convert here from the ISO-8601 input.
        const startTimeEpochSec = schedule?.startTime
          ? String(Math.floor(Date.parse(schedule.startTime) / 1000))
          : undefined;

        const scheduleParams: Record<string, unknown> | undefined = schedule
          ? {
              frequency: schedule.frequency,
              ...(startTimeEpochSec ? { startTime: startTimeEpochSec } : {}),
            }
          : undefined;

        const body: Record<string, unknown> = {
          name: flowName,
          description: flowDescription,
          // Adobe's Audience Activation API expects flowSpec as a bare string
          // (the flowSpec ID) at the top level, NOT an object with id/version.
          flowSpec: STANDARD_PROFILE_TO_DESTINATION_FLOW_SPEC_ID,
          sourceConnectionIds: [sourceConnectionId],
          targetConnectionIds: [destinationConnectionId],
          transformations: [
            {
              name: "GeneralTransform",
              params: {
                profileSelectors: {
                  selectors: [
                    {
                      type: "PROFILE_ATTRIBUTE",
                      value: {
                        name: "identityMap",
                        matcher: "EXISTS",
                      },
                    },
                  ],
                },
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

        const created = await ctx.client.request<{
          id: string;
          status?: string;
        }>({
          method: "POST",
          path: "/data/foundation/flowservice/flows",
          body,
        });

        logger.info(
          {
            tool: TOOL_NAME,
            flowId: created.id,
            segmentId,
            sourceConnectionId,
            destinationConnectionId,
          },
          "Segment activation flow created",
        );

        return toolResult({
          flowId: created.id,
          status: created.status ?? "CREATED",
          segmentId,
          sourceConnectionId,
          destinationConnectionId,
          name: flowName,
        });
      } catch (err) {
        logger.error(
          {
            tool: TOOL_NAME,
            segmentId,
            sourceConnectionId,
            destinationConnectionId,
            err,
          },
          "Failed to activate segment",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
