import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Destination } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_destinations";
const TOOL_DESCRIPTION =
  "List available destination connectors from the Adobe Experience Platform Destinations catalog. " +
  "These are connection specifications (templates) for activating audiences to external systems " +
  "(advertising platforms, email/SMS, cloud storage, social, etc.). " +
  "Returns a paginated list, optionally filtered by category. Filtering for destinations is performed " +
  "client-side against connection-spec attributes (isDestination / uiAttributes.flowType) because " +
  "Adobe's providerId values are opaque GUIDs.";

const inputSchema = {
  ...paginationSchema,
  category: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional category filter (e.g. 'advertising', 'email', 'social', 'cloudStorage'). " +
        "Matched case-insensitively against the connector's category.",
    ),
};

interface DestinationConnectionSpec extends Omit<Destination, "category"> {
  category?: string;
  attributes?: {
    isSource?: boolean;
    isDestination?: boolean;
    uiAttributes?: { flowType?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
}

function isDestinationSpec(spec: DestinationConnectionSpec): boolean {
  if (spec.attributes?.isDestination === true) return true;
  if (spec.attributes?.uiAttributes?.flowType === "destinations") return true;
  return false;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Destinations",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, offset, category } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, limit, offset, category },
          "Listing destination connectors",
        );

        // Fetch all connectionSpecs and filter client-side. providerId values are
        // opaque GUIDs, so server-side filtering is not reliable — we filter on
        // attributes.isDestination / uiAttributes.flowType.
        const response = await ctx.client.request<
          AepListResponse<DestinationConnectionSpec>
        >({
          method: "GET",
          path: "/data/foundation/flowservice/connectionSpecs",
        });

        const allSpecs =
          response.results ??
          response.children ??
          response._embedded?.results ??
          [];

        let allResults = allSpecs.filter(isDestinationSpec);

        if (category) {
          const needle = category.toLowerCase();
          allResults = allResults.filter(
            (destination) =>
              (destination.category ?? "").toLowerCase() === needle,
          );
        }

        const total = allResults.length;
        const paginated = allResults.slice(offset, offset + limit);

        return toolResult(
          buildPaginatedResponse<Destination>(
            paginated as unknown as Destination[],
            total,
            { limit, offset },
          ),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list destination connectors",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
