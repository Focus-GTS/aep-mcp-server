/**
 * Tier 1 — read-only. Safe against any tenant, including production.
 *
 * These look easy. They are not trivial: each one has a documented way to
 * appear to succeed while being wrong, and the verify step is written to catch
 * that specific failure rather than to confirm a 200.
 */
import { validateTask } from "./schema.mjs";

export default [
  validateTask({
    id: "read-001-enumerate-datasets",
    tier: 1,
    goal: "How many datasets are in this sandbox, and what is the name of the first one?",
    rationale:
      "The most basic competence there is. It also catches a real class of bug: " +
      "a list tool that returns an empty page because it sent the wrong paging " +
      "parameter still returns 200, and looks like an empty tenant.",
    expectedCalls: 1,
    async run({ call }) {
      this._result = await call("aep_list_datasets", { limit: 10 });
    },
    async verify({ client }) {
      // Assert against Adobe directly, not against what the tool said.
      const raw = await client.request({
        method: "GET",
        path: "/data/foundation/catalog/dataSets",
        query: { limit: 10 },
      });
      const actual = Object.keys(raw ?? {}).length;
      const reported = this._result?.payload?.datasets?.length ?? this._result?.payload?.count ?? 0;
      // The tool must agree with the tenant. Both zero is a pass on an empty
      // tenant; disagreement is a fail even when the tool returned 200.
      return actual === reported;
    },
  }),

  validateTask({
    id: "read-002-schema-pagination-is-honest",
    tier: 1,
    goal: "List schemas, then list them again with a larger page, and confirm the counts are consistent.",
    rationale:
      "Schema Registry pages by OPAQUE CURSOR. Passing start=0 — the obvious " +
      "numeric guess — returns zero results with a 200, which reads as 'this " +
      "tenant has no schemas'. This server shipped that bug. A benchmark that " +
      "only checked for a 200 would have scored it green.",
    expectedCalls: 2,
    async run({ call }) {
      this._small = await call("aep_list_schemas", { limit: 1, containerType: "tenant" });
      this._large = await call("aep_list_schemas", { limit: 10, containerType: "tenant" });
    },
    async verify() {
      const s = this._small?.payload?.schemas?.length ?? 0;
      const l = this._large?.payload?.schemas?.length ?? 0;
      if (!this._small?.ok || !this._large?.ok) return false;
      // A larger page must not return fewer rows. If the tenant has >= 1 schema,
      // a limit of 1 must return exactly 1 — not 0, which is the cursor bug.
      if (l === 0) return s === 0;
      return s === 1 && l >= s;
    },
  }),

  validateTask({
    id: "read-003-quota-is-reported",
    tier: 1,
    goal: "What is my remaining data lifecycle quota?",
    rationale:
      "A governance question an operator actually asks before a deletion. Also " +
      "the cheapest proof that Data Hygiene is reachable at all.",
    expectedCalls: 1,
    async run({ call }) {
      this._q = await call("aep_get_data_lifecycle_quota", {});
    },
    async verify({ client }) {
      if (!this._q?.ok) return false;
      const raw = await client.request({ method: "GET", path: "/data/core/hygiene/quota" });
      const names = (raw?.quotas ?? []).map((q) => q.name).sort();
      // The tool nests Adobe's envelope under `quota`, so the quota array lives
      // at payload.quota.quotas. The first version of this task read
      // payload.quotas and failed — a bug in the TASK, not the tool, which is
      // exactly the kind of thing a benchmark must be able to tell apart before
      // anyone trusts its scores.
      const reported = (this._q.payload?.quota?.quotas ?? []).map((q) => q.name).sort();
      return names.length > 0 && JSON.stringify(names) === JSON.stringify(reported);
    },
  }),

  validateTask({
    id: "read-004-empty-is-not-an-error",
    tier: 1,
    goal: "List the privacy jobs for GDPR in this sandbox.",
    rationale:
      "Adobe answers an empty privacy job list with HTTP 404. A server that " +
      "passes that through as an error tells the operator their tooling is " +
      "broken when in fact they simply have no jobs — the normal state of most " +
      "tenants. This task fails any server that does so.",
    expectedCalls: 1,
    async run({ call }) {
      this._p = await call("aep_list_privacy_jobs", { regulation: "gdpr", limit: 5 });
    },
    async verify() {
      // Passing means: no error, and a list (possibly empty) came back.
      return this._p?.ok === true && Array.isArray(this._p?.payload?.results);
    },
  }),

  validateTask({
    id: "read-005-sandbox-type-is-resolvable",
    tier: 1,
    goal: "Is the sandbox I am pointed at a development sandbox or a production one?",
    rationale:
      "Every write guard in this server depends on the answer. If sandbox type " +
      "cannot be resolved, a correctly-built server must block writes — so this " +
      "task measures whether the safety model can even function on this tenant.",
    expectedCalls: 1,
    async run({ client }) {
      this._s = await client.request({
        method: "GET",
        path: "/data/foundation/sandbox-management/",
      });
    },
    async verify({ ctx }) {
      const list = this._s?.sandboxes ?? [];
      const mine = list.find((s) => s.name === ctx.sandboxName);
      return Boolean(mine?.type);
    },
  }),
];
