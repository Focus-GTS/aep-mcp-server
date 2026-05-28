import { randomUUID } from "node:crypto";
import type { AepCredentials } from "./credentials.js";
import type { TokenCache } from "./token-cache.js";
import { AepApiError } from "../util/errors.js";
import { logger } from "../util/logger.js";

const PLATFORM_BASE = "https://platform.adobe.io";

// SSRF guard: any absolute URL passed to buildUrl must resolve to one of these suffixes.
const ALLOWED_HOST_SUFFIXES = [
  ".adobe.io",
  ".adobe.com",
  ".adobedc.net",
  ".adobelogin.com",
];

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_JITTER_MS = 200;
const MAX_JSON_PARSE_BYTES = 1_000_000;
const TRUNCATED_BODY_PREVIEW_CHARS = 1000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
]);
// Methods for which a timeout (AbortError) MUST NOT be retried, since the
// request may have been partially applied server-side and a retry could
// double-execute the operation.
const NON_IDEMPOTENT_METHODS = new Set(["POST", "PATCH"]);

export type QueryValue = string | number | boolean | undefined;
export type QueryRecord = Record<string, QueryValue | QueryValue[]>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: QueryRecord;
  headers?: Record<string, string>;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // fetch surfaces network failures as TypeError with a `cause` carrying a `code`.
  const cause = (err as { cause?: { code?: string; name?: string } }).cause;
  if (cause?.code && RETRYABLE_NETWORK_CODES.has(cause.code)) {
    return true;
  }
  if (err.name === "AbortError") {
    // AbortSignal.timeout-driven aborts are worth retrying.
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AepClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly credentials: AepCredentials,
    private readonly tokenCache: TokenCache,
  ) {
    this.timeoutMs = readPositiveIntEnv(
      "AEP_REQUEST_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
    );
    this.maxRetries = readPositiveIntEnv(
      "AEP_MAX_RETRIES",
      DEFAULT_MAX_RETRIES,
    );
  }

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    return this.executeWithAuthRetry<T>(options, false);
  }

  private async executeWithAuthRetry<T>(
    options: RequestOptions,
    isAuthRetry: boolean,
  ): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const token = await this.tokenCache.getToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "x-api-key": this.credentials.clientId,
      "x-gw-ims-org-id": this.credentials.orgId,
      "x-sandbox-name": this.credentials.sandboxName,
      Accept: "application/json",
      ...options.headers,
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    const method = options.method ?? "GET";
    const requestId = randomUUID();
    const start = performance.now();
    logger.debug(
      { requestId, method, path: options.path },
      "API request",
    );

    let response: Response;
    try {
      response = await this.fetchWithRetry(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      logger.error(
        { requestId, method, path: options.path, durationMs },
        "API request failed (no response)",
      );
      throw err;
    }

    if (response.status === 401 && !isAuthRetry) {
      // Token may have been revoked or rotated server-side; refresh once and retry.
      logger.warn(
        { requestId, path: options.path },
        "Received 401, invalidating token and retrying",
      );
      this.tokenCache.invalidate();
      // Drain body to free the connection before the second attempt.
      await response.text().catch(() => "");
      return this.executeWithAuthRetry<T>(options, true);
    }

    if (!response.ok) {
      const rawText = await response.text();
      let body: unknown;
      if (rawText.length > MAX_JSON_PARSE_BYTES) {
        // Avoid parsing huge bodies into memory/objects; surface a preview only.
        body = `${rawText.slice(0, TRUNCATED_BODY_PREVIEW_CHARS)}...[truncated]`;
        logger.warn(
          {
            requestId,
            path: options.path,
            bytes: rawText.length,
          },
          "Error response body exceeded size cap; truncating",
        );
      } else {
        body = rawText;
        try {
          body = rawText ? JSON.parse(rawText) : null;
        } catch {
          // Keep rawText as body when not JSON
        }
      }
      const durationMs = Math.round(performance.now() - start);
      // ERROR-level log intentionally omits body — PII can leak through free-form
      // `detail` strings that pino redact paths won't catch. Body goes to DEBUG.
      logger.error(
        {
          requestId,
          method,
          path: options.path,
          status: response.status,
          durationMs,
        },
        "API error",
      );
      logger.debug(
        {
          requestId,
          method,
          path: options.path,
          status: response.status,
          durationMs,
          body,
        },
        "API error body",
      );
      throw new AepApiError(response.status, body);
    }

    const durationMs = Math.round(performance.now() - start);
    logger.debug(
      {
        requestId,
        method,
        path: options.path,
        status: response.status,
        durationMs,
      },
      "API request complete",
    );

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let lastError: unknown;
    const method = (init.method ?? "GET").toUpperCase();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (
          !RETRYABLE_STATUSES.has(response.status) ||
          attempt === this.maxRetries
        ) {
          return response;
        }

        const retryAfterMs =
          response.status === 429
            ? parseRetryAfter(response.headers.get("retry-after"))
            : null;
        const delay = retryAfterMs ?? this.computeBackoff(attempt);

        logger.warn(
          { status: response.status, attempt: attempt + 1, delayMs: delay },
          "Retryable HTTP status; backing off",
        );
        // Drain body so the underlying connection can be reused.
        await response.text().catch(() => "");
        await sleep(delay);
        continue;
      } catch (err) {
        lastError = err;
        // For non-idempotent methods, a timeout means the request may have
        // already been (partially) applied server-side. Retrying could
        // double-execute the operation, so we abort immediately.
        if (isAbortError(err) && NON_IDEMPOTENT_METHODS.has(method)) {
          logger.error(
            { method, attempt: attempt + 1 },
            `${method} timeout, not retrying to avoid double-execution`,
          );
          throw err;
        }
        if (!isRetryableNetworkError(err) || attempt === this.maxRetries) {
          throw err;
        }
        const delay = this.computeBackoff(attempt);
        logger.warn(
          { err, attempt: attempt + 1, delayMs: delay },
          "Retryable network error; backing off",
        );
        await sleep(delay);
      }
    }

    // Should be unreachable — loop either returns or throws.
    throw (
      lastError ??
      new Error("fetchWithRetry: exhausted retries without response")
    );
  }

  private computeBackoff(attempt: number): number {
    const jitter = Math.floor(Math.random() * MAX_RETRY_JITTER_MS);
    return BASE_RETRY_DELAY_MS * 2 ** attempt + jitter;
  }

  async get<T = unknown>(path: string, query?: QueryRecord): Promise<T> {
    return this.request<T>({ path, query });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "POST", path, body });
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PUT", path, body });
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", path, body });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>({ method: "DELETE", path });
  }

  private buildUrl(path: string, query?: QueryRecord): string {
    let url: URL;
    if (path.startsWith("http")) {
      try {
        url = new URL(path);
      } catch {
        throw new AepApiError(0, null, `Invalid absolute URL: ${path}`);
      }
      const hostname = url.hostname.toLowerCase();
      const allowed = ALLOWED_HOST_SUFFIXES.some(
        (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
      );
      if (!allowed) {
        throw new AepApiError(
          0,
          null,
          `SSRF guard: non-Adobe URL rejected: ${hostname}`,
        );
      }
    } else {
      url = new URL(`${PLATFORM_BASE}${path}`);
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v !== undefined) {
              url.searchParams.append(key, String(v));
            }
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }
}
