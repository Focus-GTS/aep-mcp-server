#!/usr/bin/env tsx
/**
 * Live integration test against real AEP sandbox.
 * Run with: npx tsx tests/integration/live-test.ts
 *
 * Requires .env with valid AEP credentials.
 */

import { loadCredentials } from "../../src/auth/credentials.js";
import { TokenCache } from "../../src/auth/token-cache.js";
import { AepClient } from "../../src/auth/aep-client.js";
import { AepApiError } from "../../src/util/errors.js";

interface TestResult {
  category: string;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  duration: number;
  message?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function color(text: string, c: "green" | "red" | "yellow" | "blue" | "gray"): string {
  const codes = { green: 32, red: 31, yellow: 33, blue: 34, gray: 90 };
  return `\x1b[${codes[c]}m${text}\x1b[0m`;
}

async function run(
  category: string,
  name: string,
  fn: () => Promise<unknown>,
): Promise<TestResult> {
  const start = Date.now();
  process.stdout.write(`  ${color("→", "blue")} ${name} ... `);

  try {
    const result = await fn();
    const duration = Date.now() - start;
    const r: TestResult = {
      category,
      name,
      status: "PASS",
      duration,
      details: result,
    };
    console.log(color(`✓ ${duration}ms`, "green"));
    results.push(r);
    return r;
  } catch (err) {
    const duration = Date.now() - start;
    const isApiError = err instanceof AepApiError;
    const message = isApiError
      ? `HTTP ${err.status}: ${JSON.stringify(err.body).slice(0, 200)}`
      : err instanceof Error
        ? err.message
        : String(err);
    const r: TestResult = {
      category,
      name,
      status: "FAIL",
      duration,
      message,
    };
    console.log(color(`✗ ${duration}ms`, "red"));
    console.log(`    ${color(message, "gray")}`);
    results.push(r);
    return r;
  }
}

function skip(category: string, name: string, reason: string): void {
  console.log(`  ${color("⊘", "yellow")} ${name} ${color(`(skipped: ${reason})`, "gray")}`);
  results.push({
    category,
    name,
    status: "SKIP",
    duration: 0,
    message: reason,
  });
}

async function main() {
  console.log(color("\n=== AEP MCP Server — Live Integration Test ===\n", "blue"));

  const creds = loadCredentials();
  console.log(color(`Org:     ${creds.orgId}`, "gray"));
  console.log(color(`Sandbox: ${creds.sandboxName}`, "gray"));
  console.log();

  const tokenCache = new TokenCache(creds);
  const client = new AepClient(creds, tokenCache);

  // ============================================================
  // SCHEMAS (Tenant)
  // ============================================================
  console.log(color("\n[1/10] SCHEMAS", "blue"));

  await run("schemas", "list_schemas (tenant)", async () =>
    client.request({
      path: "/data/foundation/schemaregistry/tenant/schemas",
      query: { limit: 5 },
      headers: { Accept: "application/vnd.adobe.xed-id+json" },
    }),
  );

  await run("schemas", "list_schemas (global)", async () =>
    client.request({
      path: "/data/foundation/schemaregistry/global/schemas",
      query: { limit: 5 },
      headers: { Accept: "application/vnd.adobe.xed-id+json" },
    }),
  );

  let createdSchemaId: string | null = null;
  await run("schemas", "create_schema (Profile)", async () => {
    const body = {
      title: `AEP_MCP_Test_Profile_${Date.now()}`,
      description: "Test schema created by AEP MCP integration test",
      type: "object",
      allOf: [{ $ref: "https://ns.adobe.com/xdm/context/profile" }],
    };
    const result = (await client.request({
      method: "POST",
      path: "/data/foundation/schemaregistry/tenant/schemas",
      body,
      headers: {
        "Content-Type": "application/vnd.adobe.xed+json; version=1",
        Accept: "application/vnd.adobe.xed+json; version=1",
      },
    })) as { $id?: string; meta_altId?: string };
    createdSchemaId = result.$id ?? null;
    return { schemaId: result.$id, altId: result.meta_altId };
  });

  if (createdSchemaId) {
    await run("schemas", "get_schema (just created)", async () =>
      client.request({
        path: `/data/foundation/schemaregistry/tenant/schemas/${encodeURIComponent(createdSchemaId!)}`,
        headers: { Accept: "application/vnd.adobe.xed+json; version=1" },
      }),
    );
  } else {
    skip("schemas", "get_schema", "no schema was created");
  }

  // ============================================================
  // DATASETS
  // ============================================================
  console.log(color("\n[2/10] DATASETS", "blue"));

  await run("datasets", "list_datasets", async () =>
    client.request({
      path: "/data/foundation/catalog/dataSets",
      query: { limit: 5 },
    }),
  );

  let createdDatasetId: string | null = null;
  if (createdSchemaId) {
    await run("datasets", "create_dataset (from test schema)", async () => {
      const body = {
        name: `AEP_MCP_Test_Dataset_${Date.now()}`,
        description: "Test dataset from AEP MCP integration test",
        schemaRef: {
          id: createdSchemaId,
          contentType: "application/vnd.adobe.xed+json; version=1",
        },
      };
      const result = (await client.request({
        method: "POST",
        path: "/data/foundation/catalog/dataSets",
        body,
      })) as string[];
      const id = Array.isArray(result) ? result[0]?.split("/").pop() : null;
      createdDatasetId = id ?? null;
      return { datasetIds: result };
    });

    if (createdDatasetId) {
      await run("datasets", "get_dataset (just created)", async () =>
        client.request({
          path: `/data/foundation/catalog/dataSets/${createdDatasetId}`,
        }),
      );
    }
  } else {
    skip("datasets", "create_dataset", "no schema available");
    skip("datasets", "get_dataset", "no dataset created");
  }

  // ============================================================
  // IDENTITIES
  // ============================================================
  console.log(color("\n[3/10] IDENTITIES", "blue"));

  await run("identities", "list_identity_namespaces", async () =>
    client.request({
      path: "/data/core/idnamespace/identities",
    }),
  );

  await run("identities", "get_identity_graph (test ECID)", async () =>
    client
      .request({
        path: "/data/core/identity/cluster/members",
        query: { ns: "ECID", id: "00000000000000000000000000000001" },
      })
      .catch((err) => {
        if (err instanceof AepApiError && (err.status === 404 || err.status === 400)) {
          return { note: "Expected — test ECID has no graph data", status: err.status };
        }
        throw err;
      }),
  );

  await run("identities", "get_profile_by_identity (test email)", async () =>
    client
      .request({
        path: "/data/core/ups/access/entities",
        query: {
          "schema.name": "_xdm.context.profile",
          entityId: "test@example.com",
          entityIdNS: "email",
        },
      })
      .catch((err) => {
        if (err instanceof AepApiError && (err.status === 404 || err.status === 400)) {
          return { note: "Expected — no profile for test email", status: err.status };
        }
        throw err;
      }),
  );

  // ============================================================
  // PROFILES
  // ============================================================
  console.log(color("\n[4/10] PROFILES", "blue"));

  await run("profiles", "get_profile (test profile)", async () =>
    client
      .request({
        path: "/data/core/ups/access/entities",
        query: {
          "schema.name": "_xdm.context.profile",
          entityId: "test@example.com",
          entityIdNS: "email",
        },
      })
      .catch((err) => {
        if (err instanceof AepApiError && (err.status === 404 || err.status === 400)) {
          return { note: "Expected — no test profile exists", status: err.status };
        }
        throw err;
      }),
  );

  await run("profiles", "preview_profile (test profile)", async () =>
    client
      .request({
        path: "/data/core/ups/access/entities",
        query: {
          "schema.name": "_xdm.context.profile",
          entityId: "test@example.com",
          entityIdNS: "email",
          fields: "person.name",
        },
      })
      .catch((err) => {
        if (err instanceof AepApiError && (err.status === 404 || err.status === 400)) {
          return { note: "Expected — no test profile to preview", status: err.status };
        }
        throw err;
      }),
  );

  skip("profiles", "delete_profile", "skipped — destructive test, would trigger privacy job");

  // ============================================================
  // SEGMENTS
  // ============================================================
  console.log(color("\n[5/10] SEGMENTS", "blue"));

  await run("segments", "list_segments", async () =>
    client.request({
      path: "/data/core/ups/segment/definitions",
      query: { limit: 5 },
    }),
  );

  let createdSegmentId: string | null = null;
  await run("segments", "create_segment (simple PQL)", async () => {
    const body = {
      name: `AEP_MCP_Test_Segment_${Date.now()}`,
      description: "Test segment from AEP MCP integration test",
      schema: { name: "_xdm.context.profile" },
      expression: {
        type: "PQL",
        format: "pql/text",
        value: "person.name.firstName != null",
      },
      evaluationInfo: { continuous: { enabled: false }, batch: { enabled: true } },
    };
    const result = (await client.request({
      method: "POST",
      path: "/data/core/ups/segment/definitions",
      body,
    })) as { id?: string };
    createdSegmentId = result.id ?? null;
    return { segmentId: result.id };
  });

  await run("segments", "estimate_segment_size (2-call preview flow)", async () => {
    // Step 1: POST /preview returns a previewId
    const preview = (await client.request({
      method: "POST",
      path: "/data/core/ups/preview",
      body: {
        predicateExpression: "person.name.firstName != null",
        predicateType: "pql/text",
      },
    })) as { previewId?: string };

    if (!preview.previewId) {
      return { note: "No previewId returned", preview };
    }

    // Step 2: GET /estimate/{previewId}
    return client.request({
      path: `/data/core/ups/estimate/${encodeURIComponent(preview.previewId)}`,
    });
  });

  // ============================================================
  // SOURCES
  // ============================================================
  console.log(color("\n[6/10] SOURCES", "blue"));

  await run("sources", "list_sources (catalog, client-side filter)", async () => {
    // Fetch full catalog then filter for source-type connection specs
    const result = (await client.request({
      path: "/data/foundation/flowservice/connectionSpecs",
    })) as { items?: Array<{ attributes?: { isSource?: boolean; uiAttributes?: { flowType?: string } } }> };
    const sources = (result.items ?? []).filter(
      (s) => s.attributes?.isSource === true || s.attributes?.uiAttributes?.flowType === "sources",
    );
    return { totalCatalogSize: result.items?.length ?? 0, sourceCount: sources.length };
  });

  await run("sources", "list_dataflows", async () =>
    client.request({
      path: "/data/foundation/flowservice/flows",
      query: { limit: 5 },
    }),
  );

  // ============================================================
  // DESTINATIONS
  // ============================================================
  console.log(color("\n[7/10] DESTINATIONS", "blue"));

  await run("destinations", "list_destinations (catalog, client-side filter)", async () => {
    const result = (await client.request({
      path: "/data/foundation/flowservice/connectionSpecs",
    })) as { items?: Array<{ attributes?: { isDestination?: boolean; uiAttributes?: { flowType?: string } } }> };
    const destinations = (result.items ?? []).filter(
      (d) => d.attributes?.isDestination === true || d.attributes?.uiAttributes?.flowType === "destinations",
    );
    return { totalCatalogSize: result.items?.length ?? 0, destinationCount: destinations.length };
  });

  skip(
    "destinations",
    "activate_segment",
    "requires pre-existing destination connection (none configured in sandbox)",
  );

  // ============================================================
  // QUERY SERVICE
  // ============================================================
  console.log(color("\n[8/10] QUERY SERVICE", "blue"));

  await run("query", "list_queries (cursor pagination, no offset)", async () =>
    client.request({
      path: "/data/foundation/query/queries",
      query: { limit: 5, orderby: "-created", excludeHidden: true },
    }),
  );

  let queryId: string | null = null;
  await run("query", "run_query (simple SELECT)", async () => {
    const body = {
      name: `AEP MCP Integration Test Query ${Date.now()}`,
      description: "Simple SELECT to validate Query Service connectivity",
      dbName: "prod:all",
      sql: "SELECT 1 AS test_value",
      queryParameters: {},
    };
    const result = (await client.request({
      method: "POST",
      path: "/data/foundation/query/queries",
      body,
    })) as { id?: string; state?: string };
    queryId = result.id ?? null;
    return { queryId: result.id, state: result.state };
  });

  if (queryId) {
    await run("query", "get_query_status", async () =>
      client.request({
        path: `/data/foundation/query/queries/${encodeURIComponent(queryId!)}`,
      }),
    );
  } else {
    skip("query", "get_query_status", "no query was created");
  }

  // ============================================================
  // PRIVACY SERVICE
  // ============================================================
  console.log(color("\n[9/10] PRIVACY SERVICE", "blue"));

  await run("privacy", "list_privacy_namespaces", async () =>
    client.request({
      path: "/data/core/privacy/namespaces",
    }),
  );

  await run("privacy", "list_privacy_jobs (regulation=gdpr)", async () =>
    client
      .request({
        path: "/data/core/privacy/jobs",
        query: { regulation: "gdpr", limit: 3 },
      })
      .catch((err) => {
        // 404 = "no jobs exist yet" — expected on a fresh sandbox
        if (err instanceof AepApiError && err.status === 404) {
          return { note: "No privacy jobs exist yet — expected", status: 404 };
        }
        throw err;
      }),
  );

  // ============================================================
  // DATASTREAMS
  // ============================================================
  console.log(color("\n[10/10] DATASTREAMS", "blue"));

  await run("datastreams", "list_datastreams", async () =>
    client.request({
      path: "/data/core/edge/datastreams",
      query: { limit: 5 },
    }),
  );

  skip(
    "datastreams",
    "get_datastream",
    "requires a real datastream ID (none guaranteed in fresh sandbox)",
  );
  skip(
    "datastreams",
    "create_datastream",
    "destructive — would create a real datastream, manual-only",
  );
  skip(
    "datastreams",
    "update_datastream",
    "destructive — would modify a real datastream, manual-only",
  );
  skip(
    "datastreams",
    "delete_datastream",
    "destructive — would delete a real datastream, manual-only",
  );

  // ============================================================
  // CLEANUP
  // ============================================================
  console.log(color("\n[CLEANUP]", "blue"));

  if (createdSegmentId) {
    await run("cleanup", "delete test segment", async () =>
      client.request({
        method: "DELETE",
        path: `/data/core/ups/segment/definitions/${createdSegmentId}`,
      }),
    );
  }

  if (createdDatasetId) {
    await run("cleanup", "delete test dataset", async () =>
      client.request({
        method: "DELETE",
        path: `/data/foundation/catalog/dataSets/${createdDatasetId}`,
      }),
    );
  }

  if (createdSchemaId) {
    await run("cleanup", "delete test schema", async () =>
      client.request({
        method: "DELETE",
        path: `/data/foundation/schemaregistry/tenant/schemas/${encodeURIComponent(createdSchemaId)}`,
      }),
    );
  }

  // ============================================================
  // REPORT
  // ============================================================
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(color("\n" + "=".repeat(60), "blue"));
  console.log(color("FINAL RESULTS", "blue"));
  console.log(color("=".repeat(60), "blue"));
  console.log(`  Total:   ${total}`);
  console.log(`  ${color("Passed:  " + passed, "green")}`);
  console.log(`  ${color("Failed:  " + failed, failed > 0 ? "red" : "gray")}`);
  console.log(`  ${color("Skipped: " + skipped, "yellow")}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  if (failed > 0) {
    console.log(color("\nFAILED TESTS:", "red"));
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => {
        console.log(`  ${color("✗", "red")} [${r.category}] ${r.name}`);
        console.log(`    ${color(r.message ?? "", "gray")}`);
      });
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(color("\nFATAL ERROR:", "red"), err);
  process.exit(2);
});
