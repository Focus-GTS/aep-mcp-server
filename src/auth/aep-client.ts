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
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
]);

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
    logger.debug({ method, path: options.path }, "API request");

    const response = await this.fetchWithRetry(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && !isAuthRetry) {
      // Token may have been revoked or rotated server-side; refresh once and retry.
      logger.warn(
        { path: options.path },
        "Received 401, invalidating token and retrying",
      );
      this.tokenCache.invalidate();
      // Drain body to free the connection before the second attempt.
      await response.text().catch(() => "");
      return this.executeWithAuthRetry<T>(options, true);
    }

    if (!response.ok) {
      const rawText = await response.text();
      let body: unknown = rawText;
      try {
        body = rawText ? JSON.parse(rawText) : null;
      } catch {
        // Keep rawText as body when not JSON
      }
      logger.error(
        { status: response.status, path: options.path, body },
        "API error",
      );
      throw new AepApiError(response.status, body);
    }

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
