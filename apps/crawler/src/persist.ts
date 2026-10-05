import type { Candidate } from './types';

interface Options {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetcher?: typeof fetch;
}

const columns = [
  'title', 'year', 'scope', 'series', 'subject', 'regions_json', 'format',
  'resource_url', 'source_url', 'origin_type', 'subject_role', 'resource_kind',
  'resource_link_type', 'classification', 'raw_json',
] as const;

const sql = `INSERT INTO candidates (
  source_key, external_key, title, year, scope, series, subject, regions_json,
  format, resource_url, source_url, origin_type, subject_role, resource_kind,
  resource_link_type, classification, raw_json, discovered_at, updated_at
) VALUES (?, ?, ?, CAST(NULLIF(?, '') AS INTEGER), NULLIF(?, ''), NULLIF(?, ''),
  NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(source_key, external_key) DO UPDATE SET
  ${columns.map((column) => `${column} = excluded.${column}`).join(',\n  ')},
  updated_at = CURRENT_TIMESTAMP
WHERE ${columns.map((column) => `candidates.${column} IS NOT excluded.${column}`).join(' OR ')}`;

export async function upsertCandidates(candidates: Candidate[], options: Options): Promise<number> {
  const fetcher = options.fetcher ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`;
  for (let index = 0; index < candidates.length; index += 50) {
    const batch = candidates.slice(index, index + 50).map((candidate) => ({
      sql,
      params: [candidate.source_key, candidate.external_key, candidate.title,
        String(candidate.year ?? ''), candidate.scope ?? '', candidate.series ?? '',
        candidate.subject ?? '', candidate.regions_json, candidate.format ?? '',
        candidate.resource_url ?? '', candidate.source_url, candidate.origin_type,
        candidate.subject_role, candidate.resource_kind, candidate.resource_link_type,
        candidate.classification, candidate.raw_json],
    }));
    const response = await fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch }),
    });
    if (!response.ok) throw new Error(`D1 candidate upsert failed: HTTP ${response.status}`);
    const body = await response.json() as { success?: boolean; result?: Array<{ success?: boolean }>; errors?: Array<{ message?: string }> };
    if (!body.success || body.result?.some((item) => item.success !== true)) {
      throw new Error(`D1 candidate upsert failed: ${body.errors?.map((item) => item.message).join('; ') || 'unknown error'}`);
    }
  }
  return candidates.length;
}
