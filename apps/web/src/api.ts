import type { OriginType, ResourceKind, SubjectRole } from '@ceepp/shared/exam';
import type {
  Page, PaperDetail, PaperFilters, PaperResource, PaperStatus, PaperSummary, Scope,
} from '@ceepp/shared/api';

export type {
  Page, PaperDetail, PaperFilters, PaperResource, PaperStatus, PaperSummary, Scope,
} from '@ceepp/shared/api';

export interface ResourceInput {
  format: string;
  kind?: ResourceKind;
  url: string;
  linkType: 'source' | 'drive';
  sourceName?: string;
  sourceUrl?: string;
  accessCode?: string;
  verifiedAt?: string;
}

export interface PaperInput {
  title: string;
  year: number;
  scope: Scope;
  originType: OriginType;
  series: string;
  subject: string;
  subjectRole: SubjectRole;
  regions: string[];
  resources: ResourceInput[];
}

export interface Candidate {
  id: number;
  sourceKey: string;
  externalKey: string;
  title: string;
  year: number | null;
  scope: Scope | null;
  originType?: OriginType | null;
  series: string | null;
  subject: string | null;
  subjectRole?: SubjectRole | null;
  regions: string[];
  format: string | null;
  resourceKind?: ResourceKind | null;
  resourceLinkType: 'source' | 'drive';
  resourceUrl: string | null;
  sourceUrl: string;
  classification: 'ordinary' | 'uncertain';
  reviewStatus: 'pending' | 'approved' | 'rejected';
  paperId: number | null;
}

export interface CandidateListItem extends Candidate {
  possiblePaperIds: number[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `请求失败（${response.status}）`;
    throw new Error(error);
  }
  return data as T;
}

function pagePath(path: string, page: number, status?: string): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', String(page));
  return `${path}?${params}`;
}

export function listPapers(filters: PaperFilters): Promise<Page<PaperSummary>> {
  const params = new URLSearchParams();
  for (const key of ['year', 'originType', 'subjectRole', 'region', 'subject', 'q'] as const) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  params.set('page', String(filters.page));
  return request<Page<PaperSummary>>(`/api/papers?${params}`);
}

export function getPaper(id: number): Promise<PaperDetail> {
  return request<PaperDetail>(`/api/papers/${id}`);
}

export function listCandidates(page = 1): Promise<Page<CandidateListItem>> {
  return request<Page<CandidateListItem>>(pagePath('/admin/api/candidates', page, 'pending'));
}

export function reviewCandidate(id: number, body: { action: 'create'; paper: PaperInput } | { action: 'merge'; paperId: number } | { action: 'reject' }): Promise<{ candidate: Candidate; paper?: PaperDetail }> {
  return request<{ candidate: Candidate; paper?: PaperDetail }>(`/admin/api/candidates/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
}

export function addCandidate(body: Omit<Candidate, 'id' | 'reviewStatus' | 'paperId'>): Promise<Candidate> {
  return request<Candidate>('/admin/api/candidates', { method: 'POST', body: JSON.stringify(body) });
}

export function listAdminPapers(status: PaperStatus, page = 1): Promise<Page<PaperSummary>> {
  return request<Page<PaperSummary>>(pagePath('/admin/api/papers', page, status));
}

export function getAdminPaper(id: number): Promise<PaperDetail> {
  return request<PaperDetail>(`/admin/api/papers/${id}`);
}

export function savePaper(paper: PaperInput, id?: number): Promise<PaperDetail> {
  return request<PaperDetail>(id ? `/admin/api/papers/${id}` : '/admin/api/papers', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(paper),
  });
}

export function setPaperStatus(id: number, status: PaperStatus): Promise<PaperDetail> {
  return request<PaperDetail>(`/admin/api/papers/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
}

export function deletePaper(id: number): Promise<void> {
  return request<void>(`/admin/api/papers/${id}`, { method: 'DELETE' });
}

export function uploadPaperFile(paperId: number, file: File, kind: ResourceKind): Promise<PaperResource> {
  const params = new URLSearchParams({ filename: file.name, kind });
  return request<PaperResource>(`/admin/api/papers/${paperId}/resources/file?${params}`, {
    method: 'POST',
    body: file,
    headers: {
      'content-type': kind === 'listening_audio' ? 'audio/mpeg' : 'application/pdf',
      'x-ceepp-file-size': String(file.size),
    },
  });
}

export function deletePaperResource(paperId: number, resourceId: number): Promise<void> {
  return request<void>(`/admin/api/papers/${paperId}/resources/${resourceId}`, { method: 'DELETE' });
}
