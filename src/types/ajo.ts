/**
 * Adobe Journey Optimizer types.
 *
 * Shapes are taken from live responses observed on 2026-08-18, not from
 * documentation. Fields Adobe returns but we do not strongly type are permitted
 * through the index signature rather than dropped, because AJO's campaign
 * representation varies by channel and by whether `full=true` was requested.
 */

/** AJO list envelope. Note `_page`, not the `_links`/`children` shape AEP uses. */
export interface AjoListResponse<T> {
  data?: T[];
  _page?: {
    orderby?: string;
    count?: number;
    page?: number;
    type?: string;
    totalPages?: number;
    totalCount?: number;
  };
  _links?: Record<string, unknown>;
}

/**
 * An AJO campaign.
 *
 * Only `id` is treated as reliably present. Everything else is optional: the
 * list summary and the `full=true` representation differ, and channel-specific
 * campaigns carry different fields again.
 */
export interface AjoCampaign {
  id: string;
  name?: string;
  description?: string;
  state?: string;
  status?: string;
  channel?: string;
  createdAt?: string;
  modifiedAt?: string;
  createdBy?: string;
  modifiedBy?: string;
  schedule?: Record<string, unknown>;
  [key: string]: unknown;
}
