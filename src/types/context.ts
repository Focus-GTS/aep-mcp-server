import type { AepClient } from "../auth/aep-client.js";
import type { TokenCache } from "../auth/token-cache.js";
import type { AepCredentials } from "../auth/credentials.js";

export interface ToolContext {
  client: AepClient;
  tokenCache: TokenCache;
  credentials: AepCredentials;
}
