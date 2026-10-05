import type { Candidate } from './types';
import { EXAM_REGIONS, normalizeSeries } from '@ceepp/shared/exam';

const regions = [...EXAM_REGIONS];

export function fileFormat(name: string): string | null {
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension && ['pdf', 'html', 'htm', 'doc', 'docx', 'zip'].includes(extension)
    ? extension.toUpperCase()
    : null;
}

export function classifyFile(name: string): Candidate['classification'] | null {
  const format = fileFormat(name);
  if (!format || /春季|春考|春招|单招/.test(name)) return null;
  if (/参考答案|权威答案|答案解析|解析版|题解|答案[（(]|试题答案/.test(name)) return null;
  if (/答案/.test(name) && !/(?:及|和|\+|含)答案/.test(name)) return null;
  return format === 'ZIP' || /(?:及|和|\+|含)答案|解析|部分|回忆版|实验题/.test(name)
    ? 'uncertain'
    : 'ordinary';
}

export function regionsInText(text: string): string[] {
  const ordered = regions
    .map((name) => ({ name, index: text.indexOf(name) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ name }) => name);
  return [...new Set(ordered)];
}

export function inferSeries(text: string): {
  scope: Candidate['scope']; series: string | null; regions: string[];
} {
  const short = text.replace(/\.[^.]+$/, '').replace(/^\d{4}(?:年)?/, '').replace(/[（(].*$/, '')
    .replace(/[文理]$/, '').trim();
  const national = /全国|新课标|新高考|大纲|旧课程|外语小语种/.test(short);
  if (national) {
    const normalized = normalizeSeries(short);
    const series = normalized.endsWith('卷') ? normalized : `${normalized}卷`;
    return { scope: 'national', series, regions: [] };
  }
  const matches = regionsInText(short);
  if (matches.length === 1) {
    return { scope: 'regional', series: `${matches[0]}卷`, regions: matches };
  }
  return { scope: null, series: short || null, regions: matches };
}
