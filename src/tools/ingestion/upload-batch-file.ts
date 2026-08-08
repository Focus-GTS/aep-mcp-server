import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_upload_batch_file";
const TOOL_DESCRIPTION =
  "Upload a data file into an existing Adobe Experience Platform ingestion batch. " +
  "This is step 2 of 3 in the AEP batch ingestion flow (aep_create_batch → this → " +
  "aep_complete_batch). Provide the data EITHER as `localFilePath` (read from disk, " +
  "for real data files) OR as `content` (an inline string, for small or generated " +
  "payloads) — exactly one of the two. Records must be valid XDM conforming to the " +
  "target dataset's schema; for the 'json' batch format that means newline-delimited " +
  "JSON, one record per line. Call this once per file, then call aep_complete_batch — " +
  "nothing is ingested until the batch is completed.";

// Adobe's per-file ceiling for a single batch-ingestion PUT is 512 MB, but a
// file that large is streamed by a real ETL job, not by an MCP tool holding it
// in memory. Cap well below that and tell the caller to split.
const MAX_LOCAL_FILE_BYTES = 100 * 1024 * 1024;
// Inline content arrives through the model's context, so anything approaching
// this cap is already a misuse of the `content` path.
const MAX_INLINE_CONTENT_BYTES = 10 * 1024 * 1024;

const inputSchema = {
  batchId: z
    .string()
    .min(1)
    .describe("The batch ID returned by aep_create_batch"),
  datasetId: z
    .string()
    .min(1)
    .describe(
      "The dataset ID this batch targets — must match the datasetId used to create the batch",
    ),
  fileName: z
    .string()
    .min(1)
    .describe(
      "Name to store the file under within the batch (e.g. 'profiles.json'). " +
        "Must be a bare file name, not a path — no '/', '\\', or '..' segments.",
    ),
  localFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Absolute path to a local file to upload. Mutually exclusive with `content`. " +
        `Maximum ${MAX_LOCAL_FILE_BYTES / (1024 * 1024)} MB.`,
    ),
  content: z
    .string()
    .optional()
    .describe(
      "Inline file content to upload as UTF-8. Mutually exclusive with `localFilePath`. " +
        "Use for small or model-generated payloads; use `localFilePath` for real data files.",
    ),
};

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rejects anything that would escape the batch's file namespace as a path segment. */
function invalidFileNameReason(fileName: string): string | null {
  if (fileName.includes("/") || fileName.includes("\\")) {
    return "fileName must be a bare file name and cannot contain '/' or '\\'";
  }
  if (fileName === "." || fileName === ".." || fileName.includes("..")) {
    return "fileName cannot contain '..'";
  }
  if (/[\u0000-\u001f\u007f]/.test(fileName)) {
    return "fileName cannot contain control characters";
  }
  return null;
}

async function readLocalFile(
  localFilePath: string,
): Promise<{ body: Uint8Array; byteLength: number } | { error: string }> {
  if (!isAbsolute(localFilePath)) {
    return {
      error: `localFilePath must be an absolute path, received: ${localFilePath}`,
    };
  }
  const absolutePath = resolvePath(localFilePath);

  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    return { error: `File not found or not readable: ${absolutePath}` };
  }

  if (!stats.isFile()) {
    return { error: `Not a regular file: ${absolutePath}` };
  }
  if (stats.size === 0) {
    return { error: `File is empty: ${absolutePath}` };
  }
  if (stats.size > MAX_LOCAL_FILE_BYTES) {
    return {
      error:
        `File is ${formatBytes(stats.size)}, which exceeds the ` +
        `${formatBytes(MAX_LOCAL_FILE_BYTES)} limit. Split it into multiple ` +
        `files and upload each into the same batch before completing it.`,
    };
  }

  const body = await readFile(absolutePath);
  return { body, byteLength: body.byteLength };
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Ingestion",
        operation: "write",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { batchId, datasetId, fileName, localFilePath, content } = args;

      try {
        // The MCP tool shape cannot express "exactly one of", so enforce it here.
        if (localFilePath !== undefined && content !== undefined) {
          return toolError({
            code: "INVALID_INPUT",
            message:
              "Provide exactly one of `localFilePath` or `content`, not both.",
          });
        }
        if (localFilePath === undefined && content === undefined) {
          return toolError({
            code: "INVALID_INPUT",
            message:
              "Provide either `localFilePath` (read from disk) or `content` (inline string).",
          });
        }

        const fileNameError = invalidFileNameReason(fileName);
        if (fileNameError) {
          return toolError({ code: "INVALID_INPUT", message: fileNameError });
        }

        let body: string | Uint8Array;
        let byteLength: number;
        let source: "localFilePath" | "content";

        if (localFilePath !== undefined) {
          const read = await readLocalFile(localFilePath);
          if ("error" in read) {
            return toolError({ code: "INVALID_INPUT", message: read.error });
          }
          body = read.body;
          byteLength = read.byteLength;
          source = "localFilePath";
        } else {
          const inline = content as string;
          byteLength = Buffer.byteLength(inline, "utf8");
          if (byteLength === 0) {
            return toolError({
              code: "INVALID_INPUT",
              message: "`content` is empty — nothing to upload.",
            });
          }
          if (byteLength > MAX_INLINE_CONTENT_BYTES) {
            return toolError({
              code: "INVALID_INPUT",
              message:
                `Inline content is ${formatBytes(byteLength)}, which exceeds the ` +
                `${formatBytes(MAX_INLINE_CONTENT_BYTES)} limit. Write it to a file ` +
                `and pass \`localFilePath\` instead.`,
            });
          }
          body = inline;
          source = "content";
        }

        logger.info(
          { tool: TOOL_NAME, batchId, datasetId, fileName, source, byteLength },
          "Uploading batch file",
        );

        const encodedBatchId = encodeURIComponent(batchId);
        const encodedDatasetId = encodeURIComponent(datasetId);
        const encodedFileName = encodeURIComponent(fileName);

        // Adobe answers this PUT with 200 and an empty body on success.
        await ctx.client.request<unknown>({
          method: "PUT",
          path:
            `/data/foundation/import/batches/${encodedBatchId}` +
            `/datasets/${encodedDatasetId}/files/${encodedFileName}`,
          rawBody: body,
          headers: { "Content-Type": "application/octet-stream" },
        });

        logger.info(
          { tool: TOOL_NAME, batchId, datasetId, fileName, byteLength },
          "Batch file uploaded",
        );

        return toolResult({
          batchId,
          datasetId,
          fileName,
          bytesUploaded: byteLength,
          uploaded: true,
          _nextStep:
            `Upload any remaining files into batch ${batchId}, then call ` +
            `aep_complete_batch to start processing. The data is NOT ingested until then.`,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, batchId, datasetId, fileName, err },
          "Failed to upload batch file",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
