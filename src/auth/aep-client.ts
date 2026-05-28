import type { AepCredentials } from "./credentials.js";
import type { TokenCache } from "./token-cache.js";
import { AepApiError } from "../util/errors.js";
import { logger } from "../util/logger.js";

const PLATFORM_BASE = "https://platform.adobe.io";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export class AepClient {
  constructor(
    private readonly credentials: AepCredentials,
    private readonly tokenCache: TokenCache,
  ) {}

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    const token = await this.tokenCache.getToken();
    const url = this.buildUrl(options.path, options.query);

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

    logger.debug({ method: options.method ?? "GET", path: options.path }, "API request");

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      logger.error({ status: response.status, path: options.path, body }, "API error");
      throw new AepApiError(response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async get<T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
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

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = path.startsWith("http") ? path : `${PLATFORM_BASE}${path}`;
    const url = new URL(base);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }
}
