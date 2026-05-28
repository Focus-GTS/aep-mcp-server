import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_dataset";
const TOOL_DESCRIPTION =
  "Create a new dataset in the Adobe Experience Platform Catalog backed by an XDM schema. " +
  "Optionally enables the dataset for Real-Time Customer Profile ingestion. " +
  "Returns the created dataset ID.";

const inputSchema = {
  name: z
    .string()
    .min(1)
    .max(255)
    .describe("Human-readable name for the dataset (e.g. 'Loyalty Events')"),
  description: z
    .string()
    .max(4096)
    .optional()
    .describe("Optional description of the dataset's purpose"),
  schemaRef: z
    .string()
    .min(1)
    .describe("The $id of the XDM schema this dataset will conform to"),
  enabledForProfile: z
    .boolean()
    .default(false)
    .describe(
      "When true, tags the dataset for Real-Time Customer Profile ingestion (unifiedProfile=enabled:true)",
    ),
};

interface CreateDatasetBody {
  name: string;
  description?: string;
  schemaRef: {
    id: string;
    contentType: string;
  };
  tags?: Record<string, string[]>;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Datasets",
        operation: "write",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { name, description, schemaRef, enabledForProfile } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, name, schemaRef, enabledForProfile },
          "Creating dataset",
        );

        const body: CreateDatasetBody = {
          name,
          description,
          schemaRef: {
            id: schemaRef,
            contentType: "application/vnd.adobe.xed+json; version=1",
          },
          tags: enabledForProfile
            ? { unifiedProfile: ["enabled:true"] }
            : undefined,
        };

        // The Catalog dataset-create endpoint returns an array containing the
        // newly created dataset's resource path: ["@/dataSets/{id}"].
        const response = await ctx.client.post<string[] | { id?: string }>(
          "/data/foundation/catalog/dataSets",
          body,
        );

        let datasetId: string | undefined;
        if (Array.isArray(response) && response.length > 0) {
          const path = response[0];
          // Strip the "@/dataSets/" prefix to surface just the ID.
          datasetId = path.split("/").pop();
        } else if (
          response &&
          typeof response === "object" &&
          "id" in response
        ) {
          datasetId = response.id;
        }

        logger.info({ tool: TOOL_NAME, datasetId, name }, "Dataset created");

        return toolResult({
          id: datasetId,
          name,
          schemaRef,
          enabledForProfile,
          raw: response,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, name, err },
          "Failed to create dataset",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
