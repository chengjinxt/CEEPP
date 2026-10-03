export type Scope = 'national' | 'regional';
export type PaperStatus = 'draft' | 'published';

export interface ResourceInput {
  format: string;
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
  series: string;
  subject: string;
  regions: string[];
  resources: ResourceInput[];
}

export interface PaperSummary extends Omit<PaperInput, 'resources'> {
  id: number;
  status: PaperStatus;
}

export interface PaperResource extends ResourceInput {
  id: number;
}

export interface PaperDetail extends PaperSummary {
  resources: PaperResource[];
}

export interface Candidate {
  id: number;
  sourceKey: string;
  externalKey: string;
  title: string;
  year: number | null;
  scope: Scope | null;
  series: string | null;
  subject: string | null;
  regions: string[];
  format: string | null;
  resourceUrl: string | null;
  sourceUrl: string;
  classification: 'ordinary' | 'uncertain';
  reviewStatus: 'pending' | 'approved' | 'rejected';
  paperId: number | null;
  possiblePaperIds: number[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaperFilters {
  year?: string;
  scope?: string;
  region?: string;
  subject?: string;
  q?: string;
  page: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data: unknown = await response.json().catch(() => null);
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
  for (const key of ['year', 'scope', 'region', 'subject', 'q'] as const) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  params.set('page', String(filters.page));
  return request<Page<PaperSummary>>(`/api/papers?${params}`);
}

export function getPaper(id: number): Promise<PaperDetail> {
  return request<PaperDetail>(`/api/papers/${id}`);
}

export function listCandidates(page = 1): Promise<Page<Candidate>> {
  return request<Page<Candidate>>(pagePath('/admin/api/candidates', page, 'pending'));
}

export function reviewCandidate(id: number, body: { action: 'create'; paper: PaperInput } | { action: 'merge'; paperId: number } | { action: 'reject' }): Promise<{ candidate: Candidate; paper?: PaperDetail }> {
  return request<{ candidate: Candidate; paper?: PaperDetail }>(`/admin/api/candidates/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
}

export function addCandidate(body: Omit<Candidate, 'id' | 'reviewStatus' | 'paperId' | 'possiblePaperIds'>): Promise<Candidate> {
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
