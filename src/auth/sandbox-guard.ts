import type { AepCredentials } from "./credentials.js";

/**
 * Adobe's own classification of a sandbox, from the Sandbox Management API.
 * We deliberately do NOT infer this from the sandbox name: a sandbox called
 * "prod" is not necessarily production, and — far more dangerously — a
 * production sandbox can be called anything at all.
 */
export type SandboxType = "production" | "development" | "unknown";

/**
 * How much this server is permitted to mutate.
 *
 * - `read-only`  — no writes anywhere, even in a development sandbox. Use when
 *                  handing the server to someone to explore an environment you
 *                  do not want touched.
 * - `safe`       — writes permitted only where Adobe classifies the sandbox as
 *                  `development`. The default.
 * - `production` — writes permitted anywhere. For operators running their own
 *                  change control who do not want this server second-guessing
 *                  them.
 */
export type WriteMode = "read-only" | "safe" | "production";

export const DEFAULT_WRITE_MODE: WriteMode = "safe";

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
 * Fail-CLOSED: any failure to resolve returns `unknown`, which `safe` mode
 * treats exactly like `production`. A credential that cannot read sandbox
 * metadata must not thereby earn write access.
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

function truthy(raw: string | undefined): boolean {
  const v = (raw ?? "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

export interface ResolvedMode {
  mode: WriteMode;
  /** True when the legacy AEP_ALLOW_PRODUCTION_WRITES flag selected the mode. */
  viaLegacyFlag: boolean;
  /** Set when AEP_MODE held a value we did not recognise. */
  invalidValue?: string;
}

/**
 * Resolves the write mode from the environment.
 *
 * `AEP_MODE` is authoritative. `AEP_ALLOW_PRODUCTION_WRITES=true` is retained
 * as a deprecated alias for `AEP_MODE=production` so existing deployments keep
 * working; if both are set, `AEP_MODE` wins.
 *
 * An unrecognised `AEP_MODE` falls back to `safe` rather than failing open —
 * a typo must never silently grant production write access.
 */
export function resolveWriteMode(): ResolvedMode {
  const raw = (process.env.AEP_MODE ?? "").toLowerCase().trim();

  if (raw) {
    if (raw === "read-only" || raw === "readonly") {
      return { mode: "read-only", viaLegacyFlag: false };
    }
    if (raw === "safe") return { mode: "safe", viaLegacyFlag: false };
    if (raw === "production" || raw === "prod") {
      return { mode: "production", viaLegacyFlag: false };
    }
    return {
      mode: DEFAULT_WRITE_MODE,
      viaLegacyFlag: false,
      invalidValue: process.env.AEP_MODE,
    };
  }

  if (truthy(process.env.AEP_ALLOW_PRODUCTION_WRITES)) {
    return { mode: "production", viaLegacyFlag: true };
  }

  return { mode: DEFAULT_WRITE_MODE, viaLegacyFlag: false };
}

/** Convenience for callers that only need the mode itself. */
export function currentWriteMode(): WriteMode {
  return resolveWriteMode().mode;
}

export class WriteBlockedError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly sandbox: SandboxInfo,
    public readonly mode: WriteMode,
  ) {
    super(WriteBlockedError.buildMessage(method, sandbox, mode));
    this.name = "WriteBlockedError";
  }

  private static buildMessage(
    method: string,
    sandbox: SandboxInfo,
    mode: WriteMode,
  ): string {
    if (mode === "read-only") {
      return (
        `Write blocked: ${method} refused because this server is running in ` +
        `read-only mode (AEP_MODE=read-only). No write, update, or delete ` +
        `operation is permitted in any sandbox. Set AEP_MODE=safe to allow ` +
        `writes against development sandboxes.`
      );
    }

    const why =
      sandbox.type === "production"
        ? `sandbox '${sandbox.name}' is classified by Adobe as PRODUCTION`
        : `the type of sandbox '${sandbox.name}' could not be confirmed` +
          (sandbox.reason ? ` — ${sandbox.reason}` : "");

    return (
      `Write blocked: ${method} refused because ${why}. ` +
      `In safe mode (the default) this server only writes to sandboxes Adobe ` +
      `classifies as development. Point AEP_SANDBOX_NAME at a development ` +
      `sandbox, or set AEP_MODE=production if you intend to write here.`
    );
  }
}

/**
 * Back-compat alias. The guard originally threw
 * `ProductionWriteBlockedError`; read-only mode made that name inaccurate.
 */
export { WriteBlockedError as ProductionWriteBlockedError };

/** True when the resolved mode permits production writes. */
export function productionWritesAllowed(): boolean {
  return currentWriteMode() === "production";
}

/**
 * Decides whether a request may proceed.
 *
 * GET/HEAD/OPTIONS are always allowed — including in read-only mode, which
 * restricts mutation, not access.
 *
 * `sandbox` being null means startup resolution has not completed; in `safe`
 * mode that is treated as unknown, i.e. blocked.
 */
export function assertWriteAllowed(
  method: string,
  path: string,
  sandbox: SandboxInfo | null,
  mode: WriteMode = currentWriteMode(),
): void {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return;

  const info: SandboxInfo = sandbox ?? {
    name: "(unresolved)",
    type: "unknown",
    source: "unresolved",
    reason: "Sandbox type had not been resolved when the request was made.",
  };

  if (mode === "production") return;
  if (mode === "read-only") throw new WriteBlockedError(upper, path, info, mode);

  // safe
  if (info.type === "development") return;
  throw new WriteBlockedError(upper, path, info, mode);
}
