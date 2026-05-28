import type { AepCredentials } from "./credentials.js";
import { AuthError } from "../util/errors.js";
import { logger } from "../util/logger.js";

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;
  private effectiveBufferMs = REFRESH_BUFFER_MS;
  private inFlightRefresh: Promise<string> | null = null;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly credentials: AepCredentials) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - this.effectiveBufferMs) {
      return this.token;
    }

    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    // Circuit breaker: refuse to hammer IMS while it's failing.
    const now = Date.now();
    if (this.circuitOpenUntil > now) {
      const waitMs = this.circuitOpenUntil - now;
      throw new AuthError(
        503,
        `IMS circuit breaker open after ${this.consecutiveFailures} failures; retry in ${Math.ceil(waitMs / 1000)}s`,
      );
    }

    this.inFlightRefresh = this.refresh();
    try {
      return await this.inFlightRefresh;
    } finally {
      this.inFlightRefresh = null;
    }
  }

  private async refresh(): Promise<string> {
    logger.info("Refreshing Adobe IMS access token");

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: [
        "openid",
        "AdobeID",
        "read_organizations",
        "additional_info.projectedProductContext",
        "session",
      ].join(","),
    });

    let response: Response;
    try {
      response = await fetch(IMS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      this.recordFailure();
      logger.error({ err }, "IMS token refresh network error");
      throw new AuthError(0, "IMS token refresh failed: network error");
    }

    if (!response.ok) {
      // Log the body separately at debug — never include in the thrown error message,
      // since IMS responses can contain client_id and other sensitive context.
      const text = await response.text().catch(() => "");
      logger.debug(
        { status: response.status, body: text },
        "IMS token refresh non-2xx body",
      );
      logger.error({ status: response.status }, "Token refresh failed");
      this.recordFailure();
      throw new AuthError(response.status, "IMS token refresh failed");
    }

    let data: TokenResponse;
    try {
      data = (await response.json()) as TokenResponse;
    } catch {
      this.recordFailure();
      throw new AuthError(
        response.status,
        "IMS token refresh failed: invalid JSON",
      );
    }

    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    // Clamp the refresh buffer so a short-lived token can't immediately re-trigger refresh
    // (e.g., expires_in=60 would otherwise be wholly inside REFRESH_BUFFER_MS = 5min).
    this.effectiveBufferMs = Math.min(
      REFRESH_BUFFER_MS,
      (data.expires_in * 1000) / 2,
    );

    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;

    logger.info({ expiresIn: data.expires_in }, "Token refreshed successfully");
    return this.token;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      logger.warn(
        { failures: this.consecutiveFailures, cooldownMs: CIRCUIT_COOLDOWN_MS },
        "IMS circuit breaker opened",
      );
    }
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}
