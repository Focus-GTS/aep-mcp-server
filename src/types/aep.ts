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

// --- Batch Ingestion ---

/**
 * File formats accepted by the AEP Batch Ingestion API for a batch's
 * `inputFormat.format`. Adobe accepts `json` (newline-delimited or array),
 * `parquet`, and `csv`.
 */
export type BatchInputFormat = "json" | "parquet" | "csv";

/**
 * Batch lifecycle states reported by the Catalog Service.
 *
 * The happy path is `loading` → `loaded` → `staging` → `staged` → `success`.
 * A batch that fails validation or processing lands in `failure`; a batch
 * that is created but never completed is eventually marked `abandoned`.
 * Adobe adds states over time, so consumers should treat unrecognized
 * values as non-terminal rather than erroring.
 */
export type BatchStatus =
  | "queued"
  | "processing"
  | "loading"
  | "loaded"
  | "staging"
  | "staged"
  | "success"
  | "failure"
  | "abandoned"
  | "retrying"
  | "stalled"
  | "inactive"
  | "aborted";

/** Row/byte counters the Catalog Service attaches to a batch once it processes. */
export interface BatchMetrics {
  inputByteSize?: number;
  inputFileCount?: number;
  inputRecordCount?: number;
  outputRecordCount?: number;
  outputByteSize?: number;
  failedRecordCount?: number;
  partitionCount?: number;
  [key: string]: unknown;
}

/**
 * Batch — a unit of data ingested into an AEP dataset.
 *
 * A batch is created empty (`aep_create_batch`), has one or more files
 * uploaded into it (`aep_upload_batch_file`), and is then sealed
 * (`aep_complete_batch`) which hands it to the Catalog Service for
 * validation and processing. Status is polled via `aep_get_batch_status`.
 *
 * The Batch Ingestion API and the Catalog Service return overlapping but
 * not identical field sets for the same batch, so most fields are optional
 * and an index signature preserves anything we don't strongly type.
 */
export interface Batch {
  id: string;
  status?: BatchStatus | string;
  relatedObjects?: Array<{ type: string; id: string }>;
  inputFormat?: {
    format?: BatchInputFormat | string;
    delimiter?: string;
    quote?: string;
    escape?: string;
    charset?: string;
    header?: boolean;
    [key: string]: unknown;
  };
  metrics?: BatchMetrics;
  tags?: Record<string, string[]>;
  errors?: Array<{ code?: string; description?: string; [key: string]: unknown }>;
  created?: number;
  createdUser?: string;
  updated?: number;
  updatedUser?: string;
  started?: number;
  completed?: number;
  version?: string;
  // Catalog surfaces additional fields (availableDates, replay, metrics sub-keys, …)
  // that vary by batch type and are not worth strongly typing.
  [key: string]: unknown;
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

// --- Data Hygiene / Data Lifecycle ---

export type WorkOrderAction = "delete_identity" | "delete_dataset";

export type WorkOrderStatus =
  | "received"
  | "validating"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed"
  | "error";

export interface WorkOrder {
  workorderId?: string;
  orgId?: string;
  imsOrg?: string;
  sandboxName?: string;
  action?: WorkOrderAction | string;
  status?: WorkOrderStatus | string;
  /** Dataset the work order targets, or "ALL" when it spans every dataset. */
  datasetId?: string;
  displayName?: string;
  description?: string;
  /** Number of identities/records the work order covers. */
  operationCount?: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  productStatusDetails?: Array<{
    productName?: string;
    status?: string;
    message?: string;
    updatedAt?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface DatasetExpiration {
  /** Identifier of the TTL (expiration) configuration itself. */
  ttlId?: string;
  datasetId?: string;
  datasetName?: string;
  sandboxName?: string;
  imsOrg?: string;
  status?: string;
  /** ISO 8601 timestamp at which the dataset is scheduled for deletion. */
  expiry?: string;
  displayName?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  [key: string]: unknown;
}
