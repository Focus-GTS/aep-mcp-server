import { z } from "zod";

export const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of results to return (1-100)"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination"),
};

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Pagination metadata extracted from an AEP list response.
 *
 * Adobe's list endpoints are inconsistent: some return `_page.count` /
 * `_page.totalCount`, some return a top-level `count`, some return only
 * `_links.next`, and some return nothing at all. Callers pass whatever they
 * managed to extract; anything they cannot determine is left `undefined`.
 */
export interface PageHints {
  /**
   * Total number of records across ALL pages, when the API genuinely told us.
   *
   * IMPORTANT: do NOT pass a page-level count here. Several AEP endpoints
   * (notably Schema Registry) return `count` meaning "records on this page",
   * which is NOT a total. Passing that value produced the long-standing bug
   * where `hasMore` was mathematically always false.
   */
  total?: number;
  /** A next-page link/cursor from the API (e.g. `_links.next.href`). */
  nextLink?: string;
}

export interface PaginatedResponse<T> {
  results: T[];
  /** Number of records on THIS page. */
  count: number;
  /**
   * Total across all pages. `null` when the API did not report a genuine
   * total — deliberately null rather than a guess, so callers can tell the
   * difference between "zero" and "unknown".
   */
  total: number | null;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** How `hasMore` was determined. Useful for debugging paging behaviour. */
  hasMoreBasis: "next-link" | "total" | "full-page" | "short-page";
  /** Opaque next-page link when the API provided one. */
  nextLink?: string;
}

/**
 * Builds a paginated tool response with an HONEST `hasMore`.
 *
 * Resolution order:
 *   1. The API gave an explicit next link  -> hasMore = true
 *   2. The API gave a genuine total        -> hasMore = offset + count < total
 *   3. We filled the page exactly          -> hasMore = true  (probably more)
 *   4. We got a short page                 -> hasMore = false (definitely done)
 *
 * Rule 3 is a heuristic and is reported as such via `hasMoreBasis`, so an
 * agent that follows it and gets an empty next page has not been lied to.
 */
export function buildPaginatedResponse<T>(
  results: T[],
  params: PaginationParams,
  hints: PageHints = {},
): PaginatedResponse<T> {
  const count = results.length;
  const { total, nextLink } = hints;

  let hasMore: boolean;
  let hasMoreBasis: PaginatedResponse<T>["hasMoreBasis"];

  if (nextLink) {
    hasMore = true;
    hasMoreBasis = "next-link";
  } else if (typeof total === "number") {
    hasMore = params.offset + count < total;
    hasMoreBasis = "total";
  } else if (count >= params.limit) {
    hasMore = true;
    hasMoreBasis = "full-page";
  } else {
    hasMore = false;
    hasMoreBasis = "short-page";
  }

  return {
    results,
    count,
    total: total ?? null,
    offset: params.offset,
    limit: params.limit,
    hasMore,
    hasMoreBasis,
    ...(nextLink ? { nextLink } : {}),
  };
}

/**
 * Shape of the paging metadata AEP list endpoints may return.
 * Every field is optional because coverage varies per service.
 */
interface AepPagingEnvelope {
  count?: number;
  total?: number;
  totalCount?: number;
  _page?: {
    count?: number;
    totalCount?: number;
    total?: number;
    next?: string;
  };
  _links?: {
    next?: { href?: string } | string;
  };
}

/**
 * Extracts `PageHints` from an AEP list response.
 *
 * Only values that genuinely represent a cross-page total are surfaced as
 * `total`. A bare top-level `count` is deliberately IGNORED, because in the
 * Schema Registry (and others) it means "records on this page" — treating it
 * as a total is exactly the bug this module previously shipped.
 */
export function extractPageHints(response: unknown): PageHints {
  if (!response || typeof response !== "object") return {};
  const r = response as AepPagingEnvelope;

  const total =
    r._page?.totalCount ??
    r._page?.total ??
    r.totalCount ??
    r.total ??
    undefined;

  const rawNext = r._links?.next ?? r._page?.next;
  const nextLink =
    typeof rawNext === "string"
      ? rawNext
      : typeof rawNext?.href === "string"
        ? rawNext.href
        : undefined;

  const hints: PageHints = {};
  if (typeof total === "number") hints.total = total;
  if (nextLink) hints.nextLink = nextLink;
  return hints;
}
