import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { sanitizeErrorBody } from "../../../src/util/errors.js";

/**
 * Proves what the logging configuration actually protects — and, deliberately,
 * what it does not.
 *
 * Reading a `redact.paths` list tells you what someone intended. These tests
 * tell you what happens. The distinction matters because pino's `*.` wildcard
 * matches exactly ONE level, so a secret nested any deeper passes through in
 * clear text.
 */

const REDACT_PATHS = [
  "*.client_secret",
  "*.access_token",
  "*.refresh_token",
  "*.Authorization",
  "*.authorization",
  "headers.authorization",
  "headers.Authorization",
  'headers["x-api-key"]',
  "body.client_secret",
  "body.access_token",
  "*.email",
  "*.entityId",
  "*.identityValue",
  "*.phone",
  "*.clientSecret",
  "*.token",
];

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino(
    { level: "info", redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } },
    stream,
  );
  return { logger, lines };
}

const SECRET = "p8e-ThisIsNotARealSecretButLooksLikeOne";

describe("log redaction — what is protected", () => {
  it.each([
    ["client_secret", { creds: { client_secret: SECRET } }],
    ["clientSecret", { creds: { clientSecret: SECRET } }],
    ["access_token", { resp: { access_token: SECRET } }],
    ["refresh_token", { resp: { refresh_token: SECRET } }],
    ["token", { auth: { token: SECRET } }],
    ["Authorization", { req: { Authorization: `Bearer ${SECRET}` } }],
    ["authorization", { req: { authorization: `Bearer ${SECRET}` } }],
  ])("redacts %s one level deep", (_name, payload) => {
    const { logger, lines } = capture();
    logger.info(payload, "test");
    expect(lines.join("")).not.toContain(SECRET);
    expect(lines.join("")).toContain("[REDACTED]");
  });

  it("redacts the x-api-key header", () => {
    const { logger, lines } = capture();
    logger.info({ headers: { "x-api-key": SECRET } }, "test");
    expect(lines.join("")).not.toContain(SECRET);
  });

  it.each(["email", "phone", "entityId", "identityValue"])(
    "redacts the PII field %s",
    (field) => {
      const { logger, lines } = capture();
      logger.info({ subject: { [field]: "person@example.com" } }, "test");
      expect(lines.join("")).not.toContain("person@example.com");
    },
  );
});

describe("log redaction — the documented gap", () => {
  it("does NOT redact a secret nested more than one level deep", () => {
    const { logger, lines } = capture();
    // pino's "*." wildcard matches a single level. This is three deep.
    logger.info({ err: { response: { body: { client_secret: SECRET } } } }, "test");
    expect(lines.join("")).toContain(SECRET);
  });

  it("does NOT redact a secret in the message string itself", () => {
    const { logger, lines } = capture();
    logger.info(`token was ${SECRET}`);
    expect(lines.join("")).toContain(SECRET);
  });
});

describe("the real protection: never build such an object", () => {
  it("the IMS token path does not put a response body into its error", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/auth/token-cache.ts", "utf8");

    // The failure mode this guards against: `throw new Error(await res.text())`
    // on an IMS response, which echoes request context including credentials.
    expect(src).not.toMatch(/throw new \w*Error\([^)]*await res\.(text|json)\(\)/);
    expect(src).not.toMatch(/message:\s*await res\.(text|json)\(\)/);
  });

  it("no source file logs a whole request body object", async () => {
    // Walked by hand rather than with fs.globSync, which needs Node 22+ while
    // this package supports Node 20. The original version passed locally and
    // failed CI — a test that cannot run on the minimum supported runtime is
    // not a test.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return e.isFile() && p.endsWith(".ts") ? [p] : [];
      });

    const files = walk("src");
    expect(files.length).toBeGreaterThan(0); // guard against silently scanning nothing

    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // logger.X({ body }) or logger.X({ ..., body, ... }) — the whole payload.
      // aep-client.ts is exempt: its one such call is gated behind the
      // AEP_LOG_RESPONSE_BODIES opt-in, asserted separately below.
      if (
        !f.endsWith("aep-client.ts") &&
        /logger\.(info|warn|error|debug|trace)\(\s*\{[^}]*\bbody\b\s*[,}]/.test(src)
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("stdout discipline", () => {
  it("logger writes to stderr, never stdout — stdout is the MCP JSON-RPC stream", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/util/logger.ts", "utf8");
    expect(src).toContain("pino.destination(2)");
    expect(src).not.toMatch(/pino\.destination\(\s*1\s*\)/);
  });
});

describe("raw response bodies are opt-in", () => {
  it("the only body log in aep-client.ts sits behind AEP_LOG_RESPONSE_BODIES", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/auth/aep-client.ts", "utf8");

    // Adobe error bodies can echo identity values on Profile/Identity
    // surfaces, and redaction cannot reach into an opaque string.
    const gate = src.indexOf("truthyEnv(process.env.AEP_LOG_RESPONSE_BODIES)");
    const bodyLog = src.indexOf('"API error body');
    expect(gate).toBeGreaterThan(-1);
    expect(bodyLog).toBeGreaterThan(gate);
  });

  it("the flag is not truthy by default", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/auth/aep-client.ts", "utf8");
    expect(src).not.toMatch(/AEP_LOG_RESPONSE_BODIES\s*\?\?\s*["']true["']/);
    expect(process.env.AEP_LOG_RESPONSE_BODIES).toBeUndefined();
  });
});

describe("sanitizeErrorBody keeps Adobe's nested error detail", () => {
  // Until 2026-08-17 the whitelist only examined TOP-LEVEL keys. Adobe nests
  // the useful part of many errors under `errors`, which was not whitelisted,
  // so the entire envelope was dropped and clients received `{}`. A 404
  // meaning "no privacy jobs exist" was indistinguishable from a 404 meaning
  // "no such route" — which is precisely the distinction a caller needs.
  const ADOBE_404 = {
    errors: {
      errorCode: 404,
      title: "Resource not found",
      detail: "Not able to find job data.",
      errorType: "uri=/data/core/privacy/jobs",
    },
  };

  it("preserves title and detail from the nested envelope", () => {
    const out = sanitizeErrorBody(ADOBE_404) as {
      errors?: { title?: string; detail?: string; errorCode?: number };
    };
    expect(out.errors?.title).toBe("Resource not found");
    expect(out.errors?.detail).toBe("Not able to find job data.");
    expect(out.errors?.errorCode).toBe(404);
  });

  it("still drops unlisted fields INSIDE the envelope", () => {
    const out = sanitizeErrorBody(ADOBE_404) as { errors?: Record<string, unknown> };
    expect(out.errors).not.toHaveProperty("errorType");
  });

  it("does not become a hole for arbitrary nesting", () => {
    // Only `errors` recurses, and only one level. A sensitive payload nested
    // under any other key, or deeper, must not survive.
    const out = sanitizeErrorBody({
      report: { tenantInfo: "secret" },
      errors: { detail: "ok", nested: { deeper: "secret" } },
    }) as { report?: unknown; errors?: Record<string, unknown> };
    expect(out.report).toBeUndefined();
    expect(out.errors?.nested).toBeUndefined();
    expect(out.errors?.detail).toBe("ok");
  });

  it("omits `errors` entirely when nothing inside it is whitelisted", () => {
    const out = sanitizeErrorBody({ errors: { errorType: "x", requestId: "y" } }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("errors");
  });
});
