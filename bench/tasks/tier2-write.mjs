/**
 * Tier 2 — reversible writes. Development sandboxes only.
 *
 * Each task creates something, proves it exists by reading Adobe directly, then
 * removes it and proves THAT too. Cleanup is scored: completing the goal while
 * leaving residue is not a pass.
 */
import { validateTask } from "./schema.mjs";

const stamp = () => `aecbench-${Date.now().toString(36)}`;

export default [
  validateTask({
    id: "write-001-segment-lifecycle",
    tier: 2,
    goal: "Create an audience of US customers, confirm it exists, then remove it again.",
    rationale:
      "The shortest complete write loop in the product: create, verify, delete, " +
      "verify gone. It is also the loop that was IMPOSSIBLE to close in this " +
      "server before v0.9.1, because segments could be created but never " +
      "deleted — every agent-made segment was permanent.",
    expectedCalls: 3,
    async run({ call }) {
      this._name = stamp();
      this._made = await call("aep_create_segment", {
        name: this._name,
        description: "AEC-Bench tier 2 fixture. Safe to delete.",
        pqlExpression: 'homeAddress.countryCode = "US"',
      });
      this._id = this._made?.payload?.id ?? this._made?.payload?.segmentId;
    },
    async verify({ client }) {
      if (!this._id) return false;
      // Independent read. The create call's own success flag is not evidence.
      const seg = await client.request({
        method: "GET",
        path: `/data/core/ups/segment/definitions/${encodeURIComponent(this._id)}`,
      });
      return seg?.name === this._name;
    },
    async cleanup({ call, client }) {
      if (!this._id) return { clean: true, detail: "nothing created" };
      await call("aep_delete_segment", {
        segmentId: this._id,
        dryRun: false,
        confirm: `DELETE SEGMENT ${this._id}`,
      });
      // Verify removal against Adobe, not against the delete's return value.
      try {
        await client.request({
          method: "GET",
          path: `/data/core/ups/segment/definitions/${encodeURIComponent(this._id)}`,
        });
        return { clean: false, detail: `segment ${this._id} still readable after delete` };
      } catch (err) {
        if (err?.status === 404) return { clean: true };
        return { clean: false, detail: `unexpected error verifying deletion: ${err?.status}` };
      }
    },
  }),

  validateTask({
    id: "write-002-query-runs-and-reports-state",
    tier: 2,
    goal: "Run a trivial SQL query and tell me what state it ended in.",
    rationale:
      "Proves Query Service is both entitled and correctly wired. The subtle " +
      "failure it catches: this server once derived the Query Service database " +
      "name as a hardcoded `prod:all` regardless of which sandbox was " +
      "configured, so queries silently ran against the wrong environment.",
    expectedCalls: 2,
    async run({ call }) {
      this._q = await call("aep_run_query", { sql: "SELECT 1", name: stamp() });
      this._id = this._q?.payload?.id ?? this._q?.payload?.queryId;
      if (this._id) this._status = await call("aep_get_query_status", { queryId: this._id });
    },
    async verify() {
      if (!this._id || !this._status?.ok) return false;
      const state = this._status.payload?.state ?? "";
      // Any real lifecycle state is a pass; the point is that the query was
      // accepted and is trackable, not that it finished within the run.
      return ["SUBMITTED", "QUEUED", "RUNNING", "SUCCESS"].includes(String(state).toUpperCase());
    },
    async cleanup() {
      // A query is an execution record, not stored data. Adobe expires them and
      // exposes no delete endpoint, so there is nothing to orphan.
      return { clean: true, detail: "query is an execution record; nothing to remove" };
    },
  }),
];
