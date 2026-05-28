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

// Whitelist of safe fields permitted in error details surfaced to MCP clients.
// Anything outside this set (e.g. `report`, `tenantInfo`, internal requestIds) is dropped
// to avoid leaking sensitive Adobe diagnostic context through tool errors.
const SAFE_ERROR_FIELDS = new Set([
  "status",
  "title",
  "detail",
  "type",
  "error-code",
  "code",
  "statusCode",
  "message",
]);

const MAX_ERROR_BODY_STRING_LENGTH = 200;

export function sanitizeErrorBody(body: unknown): unknown {
  if (body == null) {
    return body;
  }
  if (typeof body === "string") {
    return body.length > MAX_ERROR_BODY_STRING_LENGTH
      ? `${body.slice(0, MAX_ERROR_BODY_STRING_LENGTH)}…`
      : body;
  }
  if (typeof body !== "object") {
    return body;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (SAFE_ERROR_FIELDS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

export class AepApiError extends Error {
  public readonly body: unknown;
  constructor(
    public readonly status: number,
    body: unknown,
    message?: string,
  ) {
    super(message ?? `AEP API returned ${status}`);
    this.name = "AepApiError";
    // Sanitize body at construction so any catch block that logs the error
    // (e.g. `logger.error({ err })`) cannot leak unwhitelisted fields.
    this.body = sanitizeErrorBody(body);
  }
}

export function mapApiError(err: unknown): ToolErrorPayload {
  if (err instanceof AuthError) {
    return {
      code: `AEP_AUTH_${err.status}`,
      message: err.message,
    };
  }
  if (err instanceof AepApiError) {
    return {
      code: `AEP_${err.status}`,
      message: err.message,
      // Body is already sanitized in the AepApiError constructor.
      details: err.body,
    };
  }
  if (err instanceof Error) {
    return { code: "UNEXPECTED_ERROR", message: err.message };
  }
  return { code: "UNKNOWN_ERROR", message: String(err) };
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
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
