import type { AepCredentials } from "./credentials.js";
import { logger } from "../util/logger.js";

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;
  private inFlightRefresh: Promise<string> | null = null;

  constructor(private readonly credentials: AepCredentials) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - REFRESH_BUFFER_MS) {
      return this.token;
    }

    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
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

    const response = await fetch(IMS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, body: text }, "Token refresh failed");
      throw new Error(`IMS token refresh failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    logger.info({ expiresIn: data.expires_in }, "Token refreshed successfully");
    return this.token;
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}
