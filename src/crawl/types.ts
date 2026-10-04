import type { OriginType, ResourceKind, SubjectRole } from '../shared/exam';

export interface Candidate {
  source_key: string;
  external_key: string;
  title: string;
  year: number | null;
  scope: 'national' | 'regional' | null;
  series: string | null;
  subject: string | null;
  regions_json: string;
  format: string | null;
  resource_url: string | null;
  resource_link_type: 'source' | 'drive';
  source_url: string;
  origin_type: OriginType;
  subject_role: SubjectRole;
  resource_kind: ResourceKind;
  classification: 'ordinary' | 'uncertain';
  raw_json: string;
}
