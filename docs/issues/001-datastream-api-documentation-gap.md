# Issue 001 — No supported REST API for datastream configuration

**Status:** Open — blocked on Adobe
**Opened:** 2026-08-14
**Affects:** `aep_create_datastream`, `aep_list_datastreams`, `aep_get_datastream`, `aep_update_datastream`, `aep_delete_datastream`
**Severity:** Five tools are non-functional and now marked EXPERIMENTAL
**Adobe case:** `<ADOBE_CASE_ID>` (add this question to it)

## Summary

This server ships five datastream tools built on `/data/core/edge/datastreams`. That path returns an **HTML 404**, and Adobe's public documentation describes **no REST API for managing datastream configurations** at all.

## Evidence

### The endpoint does not respond as an API

| Date | Sandbox access | `/data/core/edge/datastreams` | Interpretation |
|---|---|---|---|
| 2026-08-12 | Credential in zero sandboxes; nearly everything 401/403 | 404, HTML | Ambiguous — could have been access |
| **2026-08-14** | **Full working access; all six required surfaces 200** | **404, HTML** | **Conclusive — the route does not exist** |

The 08-14 run is what settles it. In a sandbox where Schema Registry, Catalog, Data Hygiene, Segmentation, and Sandbox Management all return 200 on the same credential, a lone HTML 404 cannot be a permissions problem. An HTML body means the request never reached an AEP service — it hit an edge router with no matching route.

### Adobe documents no such API

Checked 2026-08-12, no change found since:

| Source | Finding |
|---|---|
| [Create and configure datastreams](https://experienceleague.adobe.com/en/docs/experience-platform/datastreams/configure) | UI workflow only. No host, path, or curl example. **This is the page the tools cite.** |
| [Datastreams overview](https://experienceleague.adobe.com/en/docs/experience-platform/datastreams/overview) | Defines datastreams; notes they are also called "edge configurations". Terminology only |
| [Data Collection API endpoints](https://developer.adobe.com/data-collection-apis/docs/endpoints/) | Edge Network API (`interact`, `collect`) and Media Edge API only. These **send events to** a datastream; they do not manage one. Hosts are `server.adobedc.net` / `edge.adobedc.net` |
| [Reactor API](https://experienceleague.adobe.com/en/docs/experience-platform/tags/api/overview) | Manages tags at `reactor.adobe.io`. No `edge_configurations` endpoint in current docs |

Datastreams appear to be UI-managed. Whether an undocumented internal endpoint exists cannot be settled from public sources.

## What was done

- All five tool **descriptions** now begin `EXPERIMENTAL — UNSUPPORTED ENDPOINT`, so it is visible in `tools/list` before any call
- The path lives in one place, `src/tools/datastreams/paths.ts`, with the evidence inline
- The validator classifies this as **UNSUPPORTED OR UNDOCUMENTED ENDPOINT**, owner *Adobe* — explicitly **not** an implementation error of ours and **not** a permissions problem
- Contract tests prevent the probe and the tools from drifting apart again, which is what masked this originally

## What was deliberately NOT done

**The path was not changed.** There is no documented path to change it to. Substituting one unverified guess for another would look like a fix while proving nothing — and would destroy the only useful property the current value has: it is the path we have always used, so it is the one worth asking Adobe about.

**The tools were not deleted.** They encode real request shapes and are cheap to retain. If Adobe confirms an API, re-pointing them is a one-line change in `paths.ts`.

## Ask for Adobe

Add to case `<ADOBE_CASE_ID>`:

> Does Adobe provide a supported REST API for creating, listing, updating, and deleting **datastream configurations** (as distinct from the Edge Network `interact`/`collect` ingestion endpoints)?
>
> If yes: what is the host, base path, API version, required headers, and the product-profile permission or entitlement that gates it?
>
> If no: can you confirm that datastream configuration is UI-only, so we can remove these tools rather than leave them marked experimental?

Either answer closes this issue. "No" is a perfectly good outcome — it converts five broken tools into a documented product boundary.

## Resolution criteria

- [ ] Adobe confirms whether a datastream configuration REST API exists
- [ ] If it exists: update `DATASTREAMS_BASE_PATH`, re-probe, and lift EXPERIMENTAL from the five descriptions
- [ ] If it does not: remove the five tools and record the boundary in the README
