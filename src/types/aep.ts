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
  fileDescription?: { persisted: boolean; containerFormat: string; format: string };
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
  identityMap: Record<string, Array<{ id: string; authenticatedState?: string }>>;
}

// --- Profiles ---

export interface ProfileEntity {
  entityId: string;
  schema: { name: string };
  entity: Record<string, unknown>;
  identityGraph?: IdentityGraph;
  consent?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  segmentMembership?: Record<string, Record<string, { status: string; timestamp: string }>>;
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
  evaluationInfo?: { continuous?: { enabled: boolean }; batch?: { enabled: boolean } };
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
