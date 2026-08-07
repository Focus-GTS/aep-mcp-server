import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_destination_connection";
const TOOL_DESCRIPTION =
  "Create a target (destination) connection in the Adobe Experience Platform Flow Service. " +
  "This produces the 'destinationConnectionId' that 'aep_activate_segment' requires — without it, " +
  "activation cannot be performed through this server at all.\n" +
  "\n" +
  "TYPICAL FLOW:\n" +
  "  1. aep_list_destinations         -> find the destination and its connectionSpec id\n" +
  "  2. aep_create_destination_connection (this tool) -> get a destinationConnectionId\n" +
  "  3. aep_activate_segment          -> activate an audience to it\n" +
  "\n" +
  "The 'params' object is destination-specific (S3 bucket + prefix, an ad platform account id, " +
  "an API endpoint, etc.). Consult the destination's page in Adobe's documentation for its required " +
  "shape. If credentials are needed, create the base connection in the AEP UI first and pass its " +
  "'baseConnectionId' here.";

const inputSchema = {
  name: z
    .string()
    .min(1)
    .max(255)
    .describe("Human-readable name for the destination connection"),
  description: z
    .string()
    .max(1000)
    .optional()
    .describe("Optional description of what this connection is for"),
  connectionSpecId: z
    .string()
    .min(1)
    .describe(
      "The destination's connection spec ID. Obtain it from 'aep_list_destinations' — it appears " +
        "as the destination catalog entry's connectionSpec.id.",
    ),
  baseConnectionId: z
    .string()
    .optional()
    .describe(
      "Optional ID of an existing base connection holding the destination's credentials. " +
        "Required for destinations that authenticate (most ad platforms and cloud storage). " +
        "Create it in the AEP UI under Destinations > Accounts if you don't have one.",
    ),
  params: z
    .record(z.unknown())
    .optional()
    .describe(
      "Destination-specific parameters. Shape varies per destination — e.g. " +
        "{ bucketName, path } for Amazon S3, or { accountId } for an ad platform. " +
        "See the destination's Adobe documentation page.",
    ),
  dataFormat: z
    .enum(["json", "parquet", "csv"])
    .optional()
    .describe(
      "Output data format for file-based destinations. Ignored by streaming destinations.",
    ),
};

interface TargetConnectionResponse {
  id?: string;
  etag?: string;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Destinations",
        operation: "write",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const {
        name,
        description,
        connectionSpecId,
        baseConnectionId,
        params,
        dataFormat,
      } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, name, connectionSpecId },
          "Creating destination connection",
        );

        const body: Record<string, unknown> = {
          name,
          connectionSpec: {
            id: connectionSpecId,
            version: "1.0",
          },
        };

        if (description !== undefined) body.description = description;
        if (baseConnectionId !== undefined) {
          body.baseConnectionId = baseConnectionId;
        }
        if (params !== undefined) body.params = params;
        if (dataFormat !== undefined) {
          body.data = { format: dataFormat };
        }

        const created = await ctx.client.request<TargetConnectionResponse>({
          method: "POST",
          path: "/data/foundation/flowservice/targetConnections",
          body,
        });

        logger.info(
          { tool: TOOL_NAME, destinationConnectionId: created?.id },
          "Destination connection created",
        );

        return toolResult({
          ...created,
          destinationConnectionId: created?.id,
          _hint:
            "Pass this 'destinationConnectionId' to 'aep_activate_segment' along with your " +
            "profile 'sourceConnectionId' to activate an audience to this destination.",
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, name, connectionSpecId, err },
          "Failed to create destination connection",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
