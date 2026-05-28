import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Dataset } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_datasets";
const TOOL_DESCRIPTION =
  "List datasets from the Adobe Experience Platform Catalog. Supports filtering by name " +
  "(contains-match) and state. Returns an array of datasets keyed by id. " +
  "Filters are sent via Adobe's 'property=field==value' (or 'field~value' for contains) syntax; " +
  "when both name and state are supplied, they are sent as repeated 'property' parameters and " +
  "AND-combined server-side.\n" +
  "\n" +
  "PAGINATION: Adobe Catalog uses opaque cursor pagination — the 'start' query param is a " +
  "dataset-ID cursor, not a numeric offset. Use 'limit' to control page size, and pass the " +
  "'nextCursor' returned by a prior call as 'startCursor' to fetch the next page.";

const inputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of results to return (1-100)"),
  startCursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from previous response's _page.next, for pagination beyond first page",
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Optional case-sensitive contains-match filter on dataset name"),
  state: z
    .enum(["DRAFT", "ENABLED", "DISABLED"])
    .optional()
    .describe("Optional filter for dataset state"),
};

type DatasetMap = Record<string, Omit<Dataset, "id">>;
type DatasetWithId = Dataset & { id: string };

// Adobe Catalog responses can include either a HAL-style _links.next.href
// or a _page.next cursor. We tolerate both shapes.
interface CatalogPageMeta {
  _page?: { next?: string | null; [k: string]: unknown };
  _links?: {
    next?: { href?: string | null; [k: string]: unknown };
    [k: string]: unknown;
  };
}

function extractNextCursor(
  response: DatasetMap & Partial<CatalogPageMeta>,
): string | null {
  const directNext = response?._page?.next;
  if (typeof directNext === "string" && directNext.length > 0) {
    return directNext;
  }
  const linkHref = response?._links?.next?.href;
  if (typeof linkHref === "string" && linkHref.length > 0) {
    // _links.next.href may be a full URL with ?start=<cursor>; extract the
    // cursor so callers can pass it back as startCursor on the next call.
    try {
      const url = new URL(
        linkHref,
        linkHref.startsWith("http") ? undefined : "https://platform.adobe.io",
      );
      const start = url.searchParams.get("start");
      if (start && start.length > 0) return start;
    } catch {
      // Not a URL — fall through and return the raw href as the cursor.
    }
    return linkHref;
  }
  return null;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Datasets",
        operation: "read",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, startCursor, name, state } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, limit, startCursor, name, state },
          "Listing datasets",
        );

        // Adobe Catalog API only supports filtering via the 'property' query param
        // using 'field==value' (exact) or 'field~value' (contains). Multiple
        // properties must be sent as repeated &property= entries.
        const propertyFilters: string[] = [];
        if (name) propertyFilters.push(`name~${name}`);
        if (state) propertyFilters.push(`state==${state}`);

        const query: Record<
          string,
          string | number | boolean | string[] | undefined
        > = {
          limit,
          // 'start' is an opaque dataset-ID cursor in Adobe Catalog — only
          // send it when the caller is paginating beyond the first page.
          ...(startCursor ? { start: startCursor } : {}),
          property: propertyFilters.length > 0 ? propertyFilters : undefined,
        };

        const response = await ctx.client.request<
          DatasetMap & Partial<CatalogPageMeta>
        >({
          method: "GET",
          path: "/data/foundation/catalog/dataSets",
          // The auth client supports array-valued query params (repeated keys).
          query: query as Record<string, string | number | boolean | undefined>,
        });

        // Catalog returns a map keyed by dataset ID. Convert to an array shape
        // with the id surfaced as a property for easier downstream consumption.
        // Skip HAL-style metadata fields (start with '_') so they don't end up
        // in the results array.
        const results: DatasetWithId[] = Object.entries(response ?? {})
          .filter(([key]) => !key.startsWith("_"))
          .map(
            ([id, dataset]) =>
              ({ id, ...(dataset as Omit<Dataset, "id">) }) as DatasetWithId,
          );

        const nextCursor = extractNextCursor(response);

        return toolResult({
          results,
          count: results.length,
          limit,
          startCursor: startCursor ?? null,
          nextCursor,
          hasMore: nextCursor !== null,
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to list datasets");
        return toolError(mapApiError(err));
      }
    },
  );
}
