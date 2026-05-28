import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ToolErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export function toolError(payload: ToolErrorPayload): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export function toolResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function mapApiError(err: unknown): ToolErrorPayload {
  if (err instanceof AepApiError) {
    return {
      code: `AEP_${err.status}`,
      message: err.message,
      details: err.body,
    };
  }
  if (err instanceof Error) {
    return { code: "UNEXPECTED_ERROR", message: err.message };
  }
  return { code: "UNKNOWN_ERROR", message: String(err) };
}

export class AepApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `AEP API returned ${status}`);
    this.name = "AepApiError";
  }
}

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `See .env.example for required configuration.`,
    );
    this.name = "MissingCredentialsError";
  }
}
