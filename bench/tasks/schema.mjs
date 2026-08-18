/**
 * AEC-Bench task format.
 *
 * A task is data, not code, so that a task set can be shared, diffed and argued
 * with independently of any runner. Each field earns its place:
 *
 *   id           stable across runs; results are keyed on it
 *   tier         1 read-only · 2 reversible write · 3 irreversible
 *   goal         what a human would ask for, in their words
 *   setup        optional: build prerequisites, returns context
 *   verify       THE ASSERTION. Reads Adobe directly and returns true/false.
 *                Never inspects the agent's own tool results — a write
 *                reporting on itself is not evidence.
 *   cleanup      optional: remove anything setup or the agent created
 *   expectedCalls the number of tool calls a competent agent should need.
 *                Exceeding it is inefficiency, not failure.
 *
 * `verify` gets a raw `client` deliberately, not the tool registry. If the
 * tools were both the instrument and the judge, a tool that lies about its own
 * success would score a pass — which is the exact failure this benchmark exists
 * to catch.
 */

/** @typedef {{ client: any, call: (name: string, args?: object) => Promise<any>, ctx: object }} TaskEnv */

/**
 * @typedef {Object} BenchTask
 * @property {string}  id
 * @property {1|2|3}   tier
 * @property {string}  goal
 * @property {string}  [rationale]   why this task is worth measuring
 * @property {number}  expectedCalls
 * @property {(env: TaskEnv) => Promise<object>} [setup]
 * @property {(env: TaskEnv) => Promise<void>}   run
 * @property {(env: TaskEnv) => Promise<boolean>} verify
 * @property {(env: TaskEnv) => Promise<{ clean: boolean, detail?: string }>} [cleanup]
 */

export const TIERS = {
  1: { name: "read", safeOnProduction: true,  needsDevSandbox: false },
  2: { name: "reversible-write", safeOnProduction: false, needsDevSandbox: true },
  3: { name: "irreversible", safeOnProduction: false, needsDevSandbox: true },
};

/** Throws if a task is malformed, so a bad task fails loudly at load. */
export function validateTask(t) {
  const problems = [];
  if (!t.id) problems.push("missing id");
  if (![1, 2, 3].includes(t.tier)) problems.push(`tier must be 1, 2 or 3 (got ${t.tier})`);
  if (!t.goal) problems.push("missing goal");
  if (typeof t.run !== "function") problems.push("missing run()");
  if (typeof t.verify !== "function") problems.push("missing verify() — a task with no independent assertion cannot be scored");
  if (t.tier >= 2 && typeof t.cleanup !== "function") {
    problems.push("tier 2+ requires cleanup() — a benchmark that dirties the tenant can only run once honestly");
  }
  if (!Number.isInteger(t.expectedCalls) || t.expectedCalls < 1) problems.push("expectedCalls must be a positive integer");
  if (problems.length) throw new Error(`task '${t.id ?? "<unnamed>"}' is invalid: ${problems.join("; ")}`);
  return t;
}
