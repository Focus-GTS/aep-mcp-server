import { MissingCredentialsError } from "../util/errors.js";

export interface AepCredentials {
  clientId: string;
  clientSecret: string;
  orgId: string;
  sandboxName: string;
}

/**
 * `AEP_SANDBOX_NAME` is required.
 *
 * It previously defaulted to `"prod"` when absent, which meant a `.env` missing
 * one line silently pointed every request at production. Reads went there with
 * no warning at all, and the operator had no signal that the sandbox they
 * believed they were using was not the one being called.
 *
 * There is no safe default for this value. A wrong guess is indistinguishable
 * from a correct one until something is read — or written — in the wrong
 * environment, so the only correct behaviour is to refuse to start.
 *
 * Setting it explicitly to `prod` remains allowed: that is a deliberate,
 * visible choice, and mutations there are still blocked by the sandbox-name
 * refusal in the write guard.
 */
const REQUIRED_VARS = [
  "AEP_CLIENT_ID",
  "AEP_CLIENT_SECRET",
  "AEP_ORG_ID",
  "AEP_SANDBOX_NAME",
] as const;

// Adobe IMS Org IDs are <20-30 alphanumeric chars>@AdobeOrg.
const ORG_ID_PATTERN = /^[A-Za-z0-9]{20,30}@AdobeOrg$/;
// AEP sandboxes are kebab/snake-case identifiers.
const SANDBOX_NAME_PATTERN = /^[a-z0-9-_]+$/i;

export function loadCredentials(): AepCredentials {
  // `.trim()` matters: `AEP_SANDBOX_NAME=` and `AEP_SANDBOX_NAME="   "` are
  // both present-but-useless, and a whitespace-only value would otherwise sail
  // through a truthiness check and be sent as an x-sandbox-name header.
  const missing = REQUIRED_VARS.filter(
    (v) => (process.env[v] ?? "").trim() === "",
  );
  if (missing.length > 0) {
    throw new MissingCredentialsError(missing as unknown as string[]);
  }

  return {
    clientId: process.env.AEP_CLIENT_ID!.trim(),
    clientSecret: process.env.AEP_CLIENT_SECRET!.trim(),
    orgId: process.env.AEP_ORG_ID!.trim(),
    sandboxName: process.env.AEP_SANDBOX_NAME!.trim(),
  };
}

/**
 * Strict format validation for credentials. Throws on the first malformed
 * value. Kept for callers that want hard failure semantics (and for tests).
 *
 * Server bootstrap deliberately calls `inspect()` instead — see below.
 */
export function validate(credentials: AepCredentials): void {
  const problems = inspect(credentials);
  if (problems.length > 0) {
    throw new Error(`Invalid AEP credentials: ${problems.join("; ")}`);
  }
}

/**
 * Non-throwing credential format check. Returns a list of human-readable
 * problems (empty when everything looks well-formed).
 *
 * Bootstrap uses this rather than `validate()` on purpose: these patterns are
 * heuristics about Adobe's ID formats, and a false positive would refuse to
 * start a server whose credentials actually work. Warning loudly gives the
 * operator the diagnostic value — "your AEP_ORG_ID looks malformed" beats an
 * opaque IMS 400 — without the ability to brick a working install. Genuinely
 * bad credentials are still caught moments later by the IMS token self-check.
 */
export function inspect(credentials: AepCredentials): string[] {
  const problems: string[] = [];

  if (!credentials.clientId || credentials.clientId.trim() === "") {
    problems.push("AEP_CLIENT_ID is empty");
  }
  if (!credentials.clientSecret || credentials.clientSecret.trim() === "") {
    problems.push("AEP_CLIENT_SECRET is empty");
  }
  if (!ORG_ID_PATTERN.test(credentials.orgId)) {
    problems.push(
      "AEP_ORG_ID does not match the expected format /^[A-Za-z0-9]{20,30}@AdobeOrg$/",
    );
  }
  if (!SANDBOX_NAME_PATTERN.test(credentials.sandboxName)) {
    problems.push(
      "AEP_SANDBOX_NAME does not match the expected format /^[a-z0-9-_]+$/i",
    );
  }

  return problems;
}
