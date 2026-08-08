import type { AepCredentials } from "./credentials.js";
import { logger } from "../util/logger.js";

/**
 * Adobe's own classification of a sandbox, from the Sandbox Management API.
 * We deliberately do NOT infer this from the sandbox name: a sandbox called
 * "prod" is not necessarily production, and — far more dangerously — a
 * production sandbox can be called anything at all.
 */
export type SandboxType = "production" | "development" | "unknown";

export interface SandboxInfo {
  name: string;
  type: SandboxType;
  title?: string;
  state?: string;
  region?: string;
  /** How `type` was determined — surfaced in errors so operators can act. */
  source: "adobe-api" | "unresolved";
  /** Populated when resolution failed, for the startup log. */
  reason?: string;
}

interface SandboxListResponse {
  sandboxes?: Array<{
    name?: string;
    title?: string;
    state?: string;
    type?: string;
    region?: string;
  }>;
}

/** Minimal shape needed here; avoids importing AepClient (circular). */
interface SandboxProbeClient {
  request<T>(options: { method: "GET"; path: string }): Promise<T>;
}

/**
 * Asks Adobe which sandbox we are actually pointed at and what type it is.
 *
 * Fail-CLOSED: any failure to resolve returns `unknown`, which the write
 * guard treats exactly like `production`. A credential that cannot read
 * sandbox metadata must not thereby earn write access.
 */
export async function resolveSandbox(
  client: SandboxProbeClient,
  credentials: AepCredentials,
): Promise<SandboxInfo> {
  const target = credentials.sandboxName;

  try {
    const res = await client.request<SandboxListResponse>({
      method: "GET",
      path: "/data/foundation/sandbox-management/",
    });

    const match = (res.sandboxes ?? []).find((s) => s.name === target);

    if (!match) {
      return {
        name: target,
        type: "unknown",
        source: "unresolved",
        reason: `Sandbox '${target}' was not present in the Sandbox Management listing for this org.`,
      };
    }

    const raw = (match.type ?? "").toLowerCase();
    const type: SandboxType =
      raw === "production"
        ? "production"
        : raw === "development"
          ? "development"
          : "unknown";

    return {
      name: target,
      type,
      title: match.title,
      state: match.state,
      region: match.region,
      source: type === "unknown" ? "unresolved" : "adobe-api",
      ...(type === "unknown"
        ? { reason: `Adobe reported an unrecognised sandbox type: '${match.type}'.` }
        : {}),
    };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    return {
      name: target,
      type: "unknown",
      source: "unresolved",
      reason:
        `Could not read the Sandbox Management API` +
        (status ? ` (HTTP ${status})` : "") +
        `. The credential may lack sandbox-view permission.`,
    };
  }
}

/** True when the operator has explicitly accepted production writes. */
export function productionWritesAllowed(): boolean {
  const raw = (process.env.AEP_ALLOW_PRODUCTION_WRITES ?? "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export class ProductionWriteBlockedError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly sandbox: SandboxInfo,
  ) {
    const why =
      sandbox.type === "production"
        ? `sandbox '${sandbox.name}' is classified by Adobe as PRODUCTION`
        : `the type of sandbox '${sandbox.name}' could not be confirmed` +
          (sandbox.reason ? ` — ${sandbox.reason}` : "");

    super(
      `Write blocked: ${method} refused because ${why}. ` +
        `This server only performs write, update, and delete operations against ` +
        `development sandboxes. Point AEP_SANDBOX_NAME at a development sandbox, ` +
        `or set AEP_ALLOW_PRODUCTION_WRITES=true to override this deliberately.`,
    );
    this.name = "ProductionWriteBlockedError";
  }
}

/**
 * Decides whether a request may proceed.
 *
 * Reads are always allowed. Everything else requires a sandbox Adobe has
 * positively identified as `development`, unless the operator has explicitly
 * opted in to production writes.
 *
 * `sandbox` being null means startup resolution has not completed — treated
 * as unknown, i.e. blocked.
 */
export function assertWriteAllowed(
  method: string,
  path: string,
  sandbox: SandboxInfo | null,
): void {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return;

  if (productionWritesAllowed()) return;

  const info: SandboxInfo = sandbox ?? {
    name: "(unresolved)",
    type: "unknown",
    source: "unresolved",
    reason: "Sandbox type had not been resolved when the request was made.",
  };

  if (info.type === "development") return;

  throw new ProductionWriteBlockedError(upper, path, info);
}
