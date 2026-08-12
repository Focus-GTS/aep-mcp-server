/**
 * Response classification for the read-only validation harness.
 *
 * Extracted from validate-readonly.mjs so it can be unit tested. The logic had
 * already produced two wrong conclusions while living inline and untested:
 *
 *   1. A 200 carrying `sandboxes: []` was reported as plain success. That empty
 *      array was the single most important result of the 2026-08-12 run — it
 *      meant the credential belonged to no sandbox and every mutation would
 *      fail closed.
 *   2. An HTML 404 was labelled an implementation error unconditionally. For a
 *      surface Adobe may not offer an API for at all, that blames our code for
 *      something that is not our bug.
 *
 * The classification decides WHO acts, so getting it wrong sends someone to
 * the wrong place — a support ticket instead of a code fix, or procurement
 * instead of an admin console.
 */

/** @typedef {"WORKING_ACCESS"|"VALID_EMPTY"|"MISSING_SANDBOX_MEMBERSHIP"|"MISSING_PRODUCT_PROFILE_PERMISSION"|"MISSING_ENTITLEMENT"|"UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT"|"IMPLEMENTATION_ERROR"|"SERVER_SIDE"|"UNKNOWN"} ClassCode */

export const LABELS = {
  WORKING_ACCESS: "WORKING ACCESS",
  VALID_EMPTY: "VALID EMPTY RESPONSE (reachable, nothing to return)",
  MISSING_SANDBOX_MEMBERSHIP: "MISSING SANDBOX MEMBERSHIP",
  MISSING_PRODUCT_PROFILE_PERMISSION: "MISSING PRODUCT-PROFILE PERMISSION",
  MISSING_ENTITLEMENT: "MISSING ENTITLEMENT (rule out org/sandbox/profile first)",
  UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT:
    "UNSUPPORTED OR UNDOCUMENTED ENDPOINT (not a permissions problem)",
  IMPLEMENTATION_ERROR: "IMPLEMENTATION ERROR",
  SERVER_SIDE: "SERVER-SIDE (Adobe)",
  UNKNOWN: "UNCLASSIFIED — investigate",
};

/** Who needs to act. Printed alongside the label so it is never ambiguous. */
export const OWNERS = {
  WORKING_ACCESS: "nobody",
  VALID_EMPTY: "nobody — but confirm empty is expected",
  MISSING_SANDBOX_MEMBERSHIP: "Adobe admin / Adobe support",
  MISSING_PRODUCT_PROFILE_PERMISSION: "Adobe admin (Admin Console)",
  MISSING_ENTITLEMENT: "Adobe account team",
  UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT: "Adobe — ask for the supported API",
  IMPLEMENTATION_ERROR: "us",
  SERVER_SIDE: "Adobe support (include x-request-id)",
  UNKNOWN: "us — investigate",
};

/** True for a 2xx whose payload is a well-formed but EMPTY collection. */
export function isEmptyCollection(body) {
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j)) return j.length === 0;
    for (const k of [
      "sandboxes", "children", "results", "definitions",
      "workorders", "data", "items", "segments",
    ]) {
      if (Array.isArray(j[k])) return j[k].length === 0;
    }
  } catch {
    /* not JSON */
  }
  return false;
}

/** True when the body is HTML rather than an API response. */
export function isHtmlBody(body, contentType = "") {
  return (
    contentType.toLowerCase().includes("html") ||
    /^\s*<(!doctype|html)/i.test(body ?? "")
  );
}

/**
 * @param {object} input
 * @param {number} input.status
 * @param {string} [input.body]
 * @param {string} [input.contentType]
 * @param {boolean} [input.documented]  false when Adobe publishes no API for
 *   this surface. Changes how an HTML 404 is attributed: our bug versus a
 *   route that may not exist at all.
 * @returns {{ code: ClassCode, label: string, owner: string }}
 */
export function classify({ status, body = "", contentType = "", documented = true }) {
  const html = isHtmlBody(body, contentType);
  const mk = (code) => ({ code, label: LABELS[code], owner: OWNERS[code] });

  if (status >= 200 && status < 300) {
    return isEmptyCollection(body) ? mk("VALID_EMPTY") : mk("WORKING_ACCESS");
  }

  // An HTML body means the request never reached an AEP service — it hit an
  // edge router with no matching route. WHY that happened depends on whether
  // the endpoint is supposed to exist.
  if (status === 404 && html) {
    return documented
      ? mk("IMPLEMENTATION_ERROR") // a documented route we are calling wrongly
      : mk("UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT"); // may simply not exist
  }

  if (status === 405 || status === 400) return mk("IMPLEMENTATION_ERROR");
  if (status === 403) return mk("MISSING_PRODUCT_PROFILE_PERMISSION");

  // A 401 on one API family while others succeed is NOT automatically a
  // missing SKU. Wrong org, wrong sandbox, and product-profile scope are all
  // more common and far cheaper to fix. The label says so.
  if (status === 401) return mk("MISSING_ENTITLEMENT");

  if (status === 404) return mk("MISSING_ENTITLEMENT"); // JSON 404: route exists, unprovisioned
  if (status >= 500) return mk("SERVER_SIDE");
  return mk("UNKNOWN");
}

/**
 * Sandbox membership is a property of the RESPONSE CONTENT, not the status
 * code: `/sandbox-management/` returns 200 whether or not the credential
 * belongs to any sandbox. Callers must check this separately.
 *
 * @returns {{ code: ClassCode, label: string, owner: string, listed: string[] }}
 */
export function classifySandboxMembership(body, targetSandbox) {
  let listed = [];
  try {
    listed = (JSON.parse(body).sandboxes ?? []).map((s) => s?.name).filter(Boolean);
  } catch {
    /* not JSON */
  }
  const present = listed.includes(targetSandbox);
  const code = present ? "WORKING_ACCESS" : "MISSING_SANDBOX_MEMBERSHIP";
  return { code, label: LABELS[code], owner: OWNERS[code], listed };
}
