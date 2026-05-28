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
