/**
 * Ownership-ledger rules for the phased validation runner.
 *
 * Pure and side-effect free so it can be unit tested without booting the
 * runner (which loads credentials and opens a client on import).
 */

/**
 * Deletion eligibility for a given run.
 *
 * Four independent conditions, all required. The point is that cleanup can
 * never be driven by a name search across a SHARED sandbox — the id must be
 * one this very run recorded creating.
 *
 * Every failing reason is collected rather than returning on the first, so a
 * refusal explains the whole picture instead of sending someone round the loop.
 */
export function assertDeletable(ledger, id) {
  const reasons = [];
  const entry = (ledger.created ?? []).find((c) => c.id === id);

  if (!entry) reasons.push("id is not in this run's ownership ledger");
  if (entry && entry.phase !== "1b") {
    reasons.push(`id was created in phase ${entry.phase}, not 1b`);
  }
  if (entry && !String(entry.name ?? "").startsWith(ledger.prefix)) {
    reasons.push(`name '${entry.name}' does not carry this run's prefix '${ledger.prefix}'`);
  }
  if ((ledger.baseline?.ids ?? []).includes(id)) {
    reasons.push("id is a BASELINE dataset — it existed before this run and must never be deleted");
  }

  if (reasons.length) {
    throw new Error(`REFUSING to delete ${id}: ${reasons.join("; ")}`);
  }
  return entry;
}

/**
 * Batch actions may only ever target a batch this run created.
 *
 * Same reasoning as datasets: in a SHARED sandbox, an id that merely looks
 * like ours is not ours. The ledger is the only acceptable source of truth.
 */
export function assertBatchOwned(ledger, batchId) {
  const entry = (ledger.batches ?? []).find((b) => b.id === batchId);
  if (!entry) {
    throw new Error(
      `REFUSING to act on batch ${batchId}: it is not in this run's ownership ledger`,
    );
  }
  return entry;
}
