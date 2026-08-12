/**
 * Single source of truth for the Datastream API path.
 *
 * ## Why this file exists
 *
 * On 2026-08-12 a live read-only probe returned an **HTML 404** for
 * `/data/foundation/edge/datastreams`. An HTML body means the request never
 * reached an AEP service at all — it hit an edge router with no matching
 * route — so the path was simply wrong.
 *
 * The twist: that path was only ever in `scripts/validate-readonly.mjs`. The
 * five datastream *tools* use `/data/core/edge/datastreams`. The probe and the
 * tools had silently disagreed, so the probe validated a path no tool uses and
 * told us nothing about the tools. Exporting the path from one place, and
 * asserting agreement in a test, makes that class of drift impossible.
 *
 * ## Documentation status: UNVERIFIED
 *
 * As of 2026-08-12, Adobe's public documentation does **not** describe a REST
 * API for datastream configuration:
 *
 *   - `experienceleague.adobe.com/en/docs/experience-platform/datastreams/configure`
 *     is UI-only. It documents no host, path, or curl example.
 *   - `developer.adobe.com/data-collection-apis/docs/endpoints/` documents only
 *     the Edge Network API (`interact`, `collect`) and the Media Edge API.
 *     Those *send events to* a datastream; they do not manage datastreams.
 *     Their hosts are `server.adobedc.net` (authenticated) and
 *     `edge.adobedc.net` (unauthenticated) — neither is this path.
 *   - The Reactor API (`reactor.adobe.io`) manages tags. Datastreams are
 *     sometimes called "edge configurations", but no `edge_configurations`
 *     endpoint appears in current Reactor documentation.
 *
 * So `/data/core/edge/datastreams` is **not documentation-supported**. It has
 * also never been confirmed live: the only probe that ran used the other,
 * definitely-wrong path.
 *
 * It has deliberately NOT been changed. There is no documented path to change
 * it *to*, and replacing an unverified guess with a different unverified guess
 * would destroy the one useful property this value has — that it is the path
 * the tools have always used, and therefore the thing to actually test once
 * credentials work.
 *
 * ## What to do when access is restored
 *
 * Probe this exact path. Then:
 *   - JSON 2xx/4xx  → the route exists; treat as documentation-gap only
 *   - HTML 404      → the path is wrong; escalate to Adobe for the real one
 *                     rather than guessing again
 */
export const DATASTREAMS_BASE_PATH = "/data/core/edge/datastreams";

/** Path for a single datastream by id. Caller must URI-encode the id. */
export function datastreamPath(encodedId: string): string {
  return `${DATASTREAMS_BASE_PATH}/${encodedId}`;
}
