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
  source_url: string;
  classification: 'ordinary' | 'uncertain';
  raw_json: string;
}
