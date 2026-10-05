import type { Candidate } from './types';
import { classifyFile, fileFormat, inferSeries, regionsInText } from './classify';
import { fetchAllowedText } from './robots';
import { normalizeSubjectRole, seriesRegions } from '@ceepp/shared/exam';

interface GitTree {
  truncated: boolean;
  tree: Array<{ type: string; path: string; sha?: string }>;
}

const TREE_URL = 'https://api.github.com/repos/deekur/gaokaomath/git/trees/main?recursive=1';

export function parseGitHubTree(payload: GitTree): Candidate[] {
  if (payload.truncated) throw new Error('GitHub tree was truncated');
  if (!Array.isArray(payload.tree)) throw new Error('Invalid GitHub tree response');
  return payload.tree.flatMap((item) => {
    const match = item.path.match(/^普通高考\/(\d{4})\/([^/]+)$/);
    if (item.type !== 'blob' || !match) return [];
    const year = Number(match[1]);
    const filename = match[2]!;
    const classification = classifyFile(filename);
    if (!classification) return [];
    const inferred = inferSeries(filename);
    const subjectRole = normalizeSubjectRole('数学');
    const regions = filename.match(/[（(]([^）)]+)[）)]/)?.[1];
    const inferredRegions = regions ? regionsInText(regions) : inferred.regions;
    const presetRegions = inferred.series ? seriesRegions(year, inferred.series, subjectRole) : [];
    const path = item.path.split('/').map(encodeURIComponent).join('/');
    return [{
      source_key: 'gaokaomath', external_key: item.path, title: filename, year,
      scope: inferred.scope, series: inferred.series, subject: '数学',
      regions_json: JSON.stringify(presetRegions.length ? presetRegions : inferredRegions),
      format: fileFormat(filename),
      resource_url: `https://raw.githubusercontent.com/deekur/gaokaomath/main/${path}`,
      resource_link_type: 'source',
      source_url: `https://github.com/deekur/gaokaomath/blob/main/${path}`,
      origin_type: inferred.scope === 'national' ? 'national' : inferred.scope === 'regional' ? 'provincial' : 'unknown',
      subject_role: subjectRole,
      resource_kind: 'question',
      classification: inferred.scope ? classification : 'uncertain',
      raw_json: JSON.stringify({ path: item.path, sha: item.sha ?? null }),
    } satisfies Candidate];
  });
}

export async function crawlGitHub(options: { fetcher?: typeof fetch; token?: string } = {}): Promise<Candidate[]> {
  const text = await fetchAllowedText(TREE_URL, options.fetcher ?? fetch, {
    Accept: 'application/vnd.github+json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });
  return parseGitHubTree(JSON.parse(text) as GitTree);
}
