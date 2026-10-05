import type { OriginType, ResourceKind, SubjectRole } from './exam';

export type Scope = 'national' | 'regional';
export type PaperStatus = 'draft' | 'published';

export interface PaperSummary {
  id: number;
  title: string;
  year: number;
  scope: Scope;
  originType: OriginType;
  series: string;
  subject: string;
  subjectRole: SubjectRole;
  regions: string[];
  status: PaperStatus;
}

export interface PaperResource {
  id: number;
  format: string;
  kind: ResourceKind;
  storageType: 'external' | 'upload';
  url: string;
  linkType: 'source' | 'drive' | 'upload';
  sourceName: string | null;
  sourceUrl: string | null;
  accessCode: string | null;
  verifiedAt: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface PaperDetail extends PaperSummary {
  resources: PaperResource[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaperFilters {
  year?: string;
  originType?: string;
  subjectRole?: string;
  region?: string;
  subject?: string;
  q?: string;
  page: number;
}
