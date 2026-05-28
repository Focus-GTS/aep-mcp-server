import { MissingCredentialsError } from "../util/errors.js";

export interface AepCredentials {
  clientId: string;
  clientSecret: string;
  orgId: string;
  sandboxName: string;
}

const REQUIRED_VARS = [
  "AEP_CLIENT_ID",
  "AEP_CLIENT_SECRET",
  "AEP_ORG_ID",
] as const;

// Adobe IMS Org IDs are <20-30 alphanumeric chars>@AdobeOrg.
const ORG_ID_PATTERN = /^[A-Za-z0-9]{20,30}@AdobeOrg$/;
// AEP sandboxes are kebab/snake-case identifiers.
const SANDBOX_NAME_PATTERN = /^[a-z0-9-_]+$/i;

export function loadCredentials(): AepCredentials {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new MissingCredentialsError(missing as unknown as string[]);
  }

  return {
    clientId: process.env.AEP_CLIENT_ID!,
    clientSecret: process.env.AEP_CLIENT_SECRET!,
    orgId: process.env.AEP_ORG_ID!,
    sandboxName: process.env.AEP_SANDBOX_NAME ?? "prod",
  };
}

/**
 * Strict format validation for credentials. Separate from `loadCredentials` so
 * existing call sites (and tests using shorthand fixtures) are unaffected.
 * Call this from server bootstrap when you want to fail fast on malformed config.
 */
export function validate(credentials: AepCredentials): void {
  const problems: string[] = [];

  if (!credentials.clientId || credentials.clientId.trim() === "") {
    problems.push("AEP_CLIENT_ID is empty");
  }
  if (!credentials.clientSecret || credentials.clientSecret.trim() === "") {
    problems.push("AEP_CLIENT_SECRET is empty");
  }
  if (!ORG_ID_PATTERN.test(credentials.orgId)) {
    problems.push("AEP_ORG_ID must match /^[A-Za-z0-9]{20,30}@AdobeOrg$/");
  }
  if (!SANDBOX_NAME_PATTERN.test(credentials.sandboxName)) {
    problems.push("AEP_SANDBOX_NAME must match /^[a-z0-9-_]+$/i");
  }

  if (problems.length > 0) {
    throw new Error(`Invalid AEP credentials: ${problems.join("; ")}`);
  }
}
