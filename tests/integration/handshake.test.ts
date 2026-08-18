import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * End-to-end MCP protocol test against the BUILT server, run with deliberately
 * invalid Adobe credentials.
 *
 * This guards a specific regression. The server originally treated a failed
 * IMS token fetch at startup as fatal and exited, which meant an MCP client
 * could never complete a handshake or call tools/list without working Adobe
 * credentials — the process was gone before it spoke a word of protocol.
 * Registries and inspectors that verify a server with placeholder credentials
 * saw only a crash, and a user could not inspect the tool surface before
 * configuring auth.
 *
 * The contract these tests lock in:
 *   1. the server starts and completes `initialize` without valid credentials
 *   2. `tools/list` returns the full surface
 *   3. annotations survive the wire, so clients can gate destructive tools
 *   4. a tool call fails as a STRUCTURED auth error, not a crash
 *
 * Requires `npm run build` first; skips cleanly if dist/ is absent so a fresh
 * checkout running `npm test` does not fail on a missing build.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const serverPath = join(repoRoot, "dist", "server.js");

// FAKE FIXTURES — every value below is fabricated and deliberately shaped to
// look like the real thing, so that credential and tenant-metadata scanners
// exercise the same code paths they would on a genuine leak. None of it
// authenticates against anything:
//   - the client ID is 32 zeroes
//   - the secret says "notarealsecret" in the middle of it
//   - the org ID is the sequence A1B2C3...E1F2
// If a scan flags this block, the scan is working. Do not replace these with
// real values to "make the test more realistic".
const BAD_CREDENTIALS = {
  AEP_CLIENT_ID: "0".repeat(32),
  AEP_CLIENT_SECRET: "p8e-notarealsecretnotarealsecret00",
  AEP_ORG_ID: "A1B2C3D4E5F6A7B8C9D0E1F2@AdobeOrg",
  AEP_SANDBOX_NAME: "dev",
  LOG_LEVEL: "silent",
};

interface JsonRpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

class McpProbe {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private received: JsonRpcMessage[] = [];

  constructor() {
    this.proc = spawn("node", [serverPath], {
      cwd: repoRoot,
      env: { ...process.env, ...BAD_CREDENTIALS },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try {
          this.received.push(JSON.parse(line) as JsonRpcMessage);
        } catch {
          // stdout must carry only JSON-RPC; anything else is a protocol
          // violation and is surfaced by the assertions below.
        }
      }
    });
  }

  send(message: Record<string, unknown>): void {
    this.proc.stdin.write(JSON.stringify(message) + "\n");
  }

  /** Waits for a response with the given id, or resolves undefined on timeout. */
  async waitFor(id: number, timeoutMs = 15_000): Promise<JsonRpcMessage | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.received.find((m) => m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    return undefined;
  }

  get alive(): boolean {
    return this.proc.exitCode === null && !this.proc.killed;
  }

  stop(): void {
    this.proc.kill();
  }
}

const hasBuild = existsSync(serverPath);

describe.skipIf(!hasBuild)(
  "MCP handshake with invalid credentials (built server)",
  () => {
    let probe: McpProbe;
    let toolCount = 0;

    beforeAll(async () => {
      probe = new McpProbe();
      probe.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "vitest-probe", version: "1.0.0" },
        },
      });
    }, 30_000);

    afterAll(() => probe?.stop());

    it("completes initialize despite authentication failing", async () => {
      const res = await probe.waitFor(1);
      expect(res, "no initialize response — did the server exit?").toBeDefined();
      expect(res?.error).toBeUndefined();
      const info = res?.result?.serverInfo as { name?: string } | undefined;
      expect(info?.name).toBe("aep-mcp-server");
    }, 30_000);

    it("stays alive rather than exiting on bad credentials", () => {
      expect(probe.alive).toBe(true);
    });

    it("lists the full tool surface", async () => {
      probe.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      probe.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

      const res = await probe.waitFor(2);
      expect(res, "no tools/list response").toBeDefined();
      const tools = res?.result?.tools as Array<Record<string, unknown>>;
      expect(Array.isArray(tools)).toBe(true);
      toolCount = tools.length;
      expect(toolCount).toBe(51);
    }, 30_000);

    it("delivers annotations over the wire so clients can gate destructive tools", async () => {
      const res = await probe.waitFor(2);
      const tools = res?.result?.tools as Array<{
        name: string;
        annotations?: Record<string, boolean>;
      }>;

      const destructive = tools.find((t) => t.name === "aep_delete_dataset");
      expect(destructive?.annotations?.destructiveHint).toBe(true);

      const readOnly = tools.find((t) => t.name === "aep_list_schemas");
      expect(readOnly?.annotations?.readOnlyHint).toBe(true);
    }, 30_000);

    it("fails a tool call as a structured auth error, not a crash", async () => {
      probe.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "aep_list_schemas", arguments: { limit: 1 } },
      });

      const res = await probe.waitFor(3, 25_000);
      expect(res, "no tools/call response").toBeDefined();
      expect(res?.result?.isError).toBe(true);

      const content = res?.result?.content as Array<{ text: string }>;
      const payload = JSON.parse(content[0].text) as { code: string };
      expect(payload.code).toMatch(/^AEP_AUTH_/);

      // The process must survive a failed call.
      expect(probe.alive).toBe(true);
    }, 40_000);
  },
);
