/**
 * Adobe Journey Optimizer paths, established by live probe on 2026-08-18 —
 * not inferred from documentation.
 *
 * That distinction is the whole reason this file exists. The datastream tools
 * were built against a path taken from a documentation page that described a UI
 * workflow, shipped for five releases, and never worked once: every request
 * returned an HTML 404 because the route did not exist. See
 * docs/adr/0005-remove-datastream-tools.md.
 *
 * WHAT WAS ACTUALLY PROBED (GET, live, authenticated):
 *
 *   200 json  /ajo/campaigns                        <- used here
 *   200 json  /journey/campaigns/service/campaigns  <- identical responses
 *   404 json  /ajo/campaigns/{unknown-id}           <- route exists, id does not
 *   404 json  /ajo/journeyVersions
 *   404 html  /ajo/journeys, /ajo/messages, /ajo/channelSurfaces,
 *             /ajo/contentTemplates, /ajo/subscriptions, /ajo/experiments,
 *             /ajo/fragments, /ajo/offers, /ajo/decisions,
 *             /journey/authoring/journeyVersions, /journey/journeys/service/journeys
 *
 * An HTML 404 is the gateway saying the route does not exist. A JSON response —
 * even a JSON 404 — means the service is there and answering. Only campaigns
 * cleared that bar, so only campaigns is wrapped. Journeys, messages, channels,
 * fragments and offers are absent on this tenant and are deliberately NOT
 * implemented: a tool that cannot succeed is worse than an absent one.
 *
 * `/ajo/campaigns` and `/journey/campaigns/service/campaigns` return byte-identical
 * payloads; the former is the documented alias and the shorter dependency.
 */

export const AJO_CAMPAIGNS_PATH = "/ajo/campaigns";

/** Single campaign by id. Ids are URL-encoded — they are UUIDs, but the encode is free. */
export function ajoCampaignPath(campaignId: string): string {
  return `${AJO_CAMPAIGNS_PATH}/${encodeURIComponent(campaignId)}`;
}
