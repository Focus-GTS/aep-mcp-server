// Adobe Experience Platform API Types

// --- Schemas (XDM) ---

export interface XdmSchema {
  $id: string;
  meta_altId: string;
  meta_resourceType: string;
  version: string;
  title: string;
  description?: string;
  type: string;
  allOf?: Array<{ $ref: string }>;
  meta_class?: string;
  meta_extends?: string[];
  meta_tenantNamespace?: string;
}

export interface CreateSchemaRequest {
  title: string;
  description?: string;
  type?: string;
  allOf: Array<{ $ref: string }>;
}

// --- Datasets ---

export interface Dataset {
  name: string;
  description?: string;
  schemaRef?: { id: string; contentType: string };
  fileDescription?: {
    persisted: boolean;
    containerFormat: string;
    format: string;
  };
  tags?: Record<string, string[]>;
  status?: string;
  enabledForProfile?: boolean;
  state?: "DRAFT" | "ENABLED" | "DISABLED";
}

// --- Identities ---

export interface IdentityNamespace {
  id: number;
  code: string;
  status: string;
  description?: string;
  idType: string;
  custom: boolean;
}

export interface IdentityGraph {
  identityMap: Record<
    string,
    Array<{ id: string; authenticatedState?: string }>
  >;
}

// --- Profiles ---

export interface ProfileEntity {
  entityId: string;
  schema: { name: string };
  entity: Record<string, unknown>;
  identityGraph?: IdentityGraph;
  consent?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  segmentMembership?: Record<
    string,
    Record<string, { status: string; timestamp: string }>
  >;
}

export interface ProfilePreview {
  entityId: string;
  profile: Record<string, unknown>;
  segments?: string[];
  identities?: IdentityGraph;
}

// --- Segments ---

export interface Segment {
  id: string;
  name: string;
  description?: string;
  expression: SegmentExpression;
  schema?: { name: string };
  ttlInDays?: number;
  evaluationInfo?: {
    continuous?: { enabled: boolean };
    batch?: { enabled: boolean };
  };
  creationTime?: string;
  updateTime?: string;
  state?: "ACTIVE" | "INACTIVE" | "DRAFT";
}

export interface SegmentExpression {
  type: "PQL";
  format: "pql/json" | "pql/text";
  value: string;
}

export interface SegmentSizeEstimate {
  segmentId: string;
  totalProfileSize: number;
  ttlInDays: number;
  state: string;
  lastUpdated: string;
}

// --- Sources ---

export interface SourceCatalog {
  id: string;
  name: string;
  description?: string;
  category: string;
  type: string;
  providerId: string;
  status: "ENABLED" | "DISABLED";
}

export interface Dataflow {
  id: string;
  name: string;
  description?: string;
  sourceConnectionIds: string[];
  targetConnectionIds: string[];
  flowSpec: { id: string; version: string };
  state: "ENABLED" | "DISABLED";
  scheduleParams?: Record<string, unknown>;
}

// --- Destinations ---

export interface Destination {
  id: string;
  name: string;
  description?: string;
  category: string;
  status: "ENABLED" | "DISABLED";
  destSpec?: { id: string; version: string };
}

export interface DestinationActivation {
  destinationId: string;
  segmentId: string;
  status: "ACTIVATED" | "PENDING" | "FAILED";
  scheduleParams?: Record<string, unknown>;
}

// --- Data Collection / Datastreams ---

/**
 * Datastream — Adobe Experience Platform Edge Network configuration that
 * routes incoming events from Web SDK / Mobile SDK / Server SDK to Adobe
 * services (AJO, Target, Analytics, AEP, Audience Manager).
 *
 * The `config` field is intentionally opaque (`Record<string, unknown>`)
 * because Adobe's Reactor / Data Collection API accepts a deeply nested
 * configuration object whose shape changes as Adobe adds services. Callers
 * should consult the Adobe documentation for the current shape:
 * https://experienceleague.adobe.com/docs/experience-platform/datastreams/configure.html
 */
export interface Datastream {
  orgId?: string;
  sandboxId?: string;
  sandboxName?: string;
  id: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  enabled?: boolean;
  // Adobe surfaces additional metadata in the response that we don't strongly type:
  // _links, settings, version, createdAt, modifiedAt, etc.
  [key: string]: unknown;
}

// --- Query Service ---

export interface Query {
  id: string;
  name?: string;
  description?: string;
  sql: string;
  state: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";
  created: string;
  updated: string;
  errors?: Array<{ code: string; message: string }>;
  rowCount?: number;
  resultLocation?: string;
}

// --- Privacy Service ---

/**
 * Supported privacy regulations per Adobe Privacy Service API as of 2026-06.
 * Source: live 400 response from the API listing all accepted values.
 * Includes both jurisdiction-level codes (gdpr, ccpa, hipaa_usa) and
 * state-specific US codes (vcdpa_va_usa, cpa_co_usa, etc.).
 */
export const PRIVACY_REGULATIONS = [
  "vcdpa_usa",
  "gdpr",
  "ccpa",
  "lgpd_bra",
  "cpra_usa",
  "apa_aus",
  "hipaa_usa",
  "pdpa_tha",
  "mhmda_usa",
  "cpa_usa",
  "ctdpa_usa",
  "ucpa_usa",
  "nzpa_nzl",
  "dpdpa_ind",
  "pipa_kor",
  "ocpa_usa",
  "tdpsa_usa",
  "fdbr_usa",
  "icdpa_usa",
  "mcdpa_usa",
  "ndpa_usa",
  "njdpa_usa",
  "nhpa_usa",
  "dpdpa_usa",
  "ql25_can",
  "tipa_tn_usa",
  "mcdpa_mn_usa",
  "vcdpa_va_usa",
  "cpra_ca_usa",
  "mhmda_wa_usa",
  "cpa_co_usa",
  "ctdpa_ct_usa",
  "ucpa_ut_usa",
  "ocpa_or_usa",
  "tdpsa_tx_usa",
  "fdbr_fl_usa",
  "icdpa_ia_usa",
  "mcdpa_mt_usa",
  "ndpa_ne_usa",
  "njdpa_nj_usa",
  "nhpa_nh_usa",
  "dpdpa_de_usa",
  "ql25_qc_can",
  "icdpa_in_usa",
  "kcdpa_ky_usa",
  "modpa_md_usa",
  "ridtppa_ri_usa",
] as const;

export type PrivacyRegulation = (typeof PRIVACY_REGULATIONS)[number];

export type PrivacyJobAction = "delete" | "access";

export type PrivacyJobStatus =
  | "submitted"
  | "processing"
  | "complete"
  | "error"
  | "cancelled";

export interface PrivacyJobUser {
  key: string;
  action: PrivacyJobAction[];
  userIDs: Array<{
    namespace: string;
    value: string;
    type?: "standard" | "custom";
    isDeletedClientSide?: boolean;
  }>;
}

export interface PrivacyJob {
  jobId: string;
  requestId?: string;
  userKey?: string;
  action?: PrivacyJobAction;
  status: PrivacyJobStatus;
  submittedBy?: string;
  createdDate?: string;
  lastModifiedDate?: string;
  userIds?: Array<{
    namespace: string;
    value: string;
    type?: string;
  }>;
  productResponses?: Array<{
    product: string;
    retryCount?: number;
    processedDate?: string;
    status?: string;
    message?: string;
  }>;
  regulation?: PrivacyRegulation;
  downloadURL?: string;
}

export interface PrivacyJobResults {
  jobId: string;
  status: PrivacyJobStatus;
  downloadURL?: string;
  productResponses?: PrivacyJob["productResponses"];
}

export interface PrivacyNamespace {
  namespace: string;
  type: "standard" | "custom";
  description?: string;
}

// --- Common API Response Wrappers ---

export interface AepListResponse<T> {
  results?: T[];
  children?: T[];
  _embedded?: { results?: T[] };
  count?: number;
  total?: number;
  _links?: {
    next?: { href: string };
    self?: { href: string };
  };
}
