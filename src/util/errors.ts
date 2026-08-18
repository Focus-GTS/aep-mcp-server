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
  // Adobe's spelling inside the nested `errors` envelope.
  "errorCode",
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
      continue;
    }
    // Adobe nests the useful part of many errors one level down:
    //   {"errors":{"errorCode":404,"title":"Resource not found",
    //              "detail":"Not able to find job data."}}
    // The whitelist only ever looked at top-level keys, so `errors` was not
    // matched and the whole envelope was dropped — every error of this shape
    // reached the client with an empty body and no explanation. Found on
    // 2026-08-17 when a 404 meaning "no privacy jobs exist" arrived
    // indistinguishable from a 404 meaning "no such route".
    //
    // Recurse ONE level, applying the same whitelist, so the detail survives
    // while anything unlisted inside it is still dropped. One level, not
    // arbitrary depth: the point is to keep the whitelist authoritative rather
    // than to walk whatever Adobe nests.
    if (key === "errors" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const inner: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SAFE_ERROR_FIELDS.has(k)) inner[k] = v;
      }
      if (Object.keys(inner).length > 0) out[key] = inner;
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
  // Surfaced as a structured tool error rather than an exception so the
  // calling agent gets an actionable message instead of a stack trace.
  if (
    err instanceof Error &&
    (err.name === "WriteBlockedError" ||
      err.name === "ProductionWriteBlockedError")
  ) {
    return {
      code: "WRITE_BLOCKED",
      message: err.message,
    };
  }
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
    const sandboxMissing = missing.includes("AEP_SANDBOX_NAME");
    super(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `See .env.example for required configuration.` +
        (sandboxMissing
          ? ` AEP_SANDBOX_NAME has no default — it used to fall back to 'prod', ` +
            `which meant a missing line silently pointed every request at ` +
            `production. Set it explicitly to the sandbox you intend to use.`
          : ""),
    );
    this.name = "MissingCredentialsError";
  }
}
