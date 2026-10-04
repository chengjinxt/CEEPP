import type { Candidate } from './types';
import { load } from 'cheerio';
import { classifyFile, fileFormat, inferSeries, regionsInText } from './classify';
import { fetchAllowedText } from './robots';
import {
  normalizeResourceKind,
  normalizeSeries,
  normalizeSubject,
  normalizeSubjectRole,
  seriesRegions,
  type OriginType,
} from '../shared/exam';

const INDEX_URL = 'https://t.urongda.com/exams';
const ELECTIVE_REGIONS = new Set(['北京', '天津', '上海', '浙江', '山东', '海南']);
const TRADITIONAL_COMPONENT_SUBJECTS = new Set(['物理', '历史', '化学', '地理', '思想政治', '生物学']);
const JOINT_EVIDENCE = /联考|联合命题|共同命题|协作(?:体|组)/u;

export function discoverUrongdaYearUrls(html: string): string[] {
  const $ = load(html);
  const urls = new Set<string>();
  $('a[href]').each((_index, link) => {
    let url: URL;
    try {
      url = new URL($(link).attr('href')!, INDEX_URL);
    } catch {
      return;
    }
    if (url.origin === 'https://t.urongda.com' && /^\/exams\/gaokao-\d{4}\/?$/.test(url.pathname)) {
      urls.add(`${url.origin}${url.pathname.replace(/\/$/, '')}`);
    }
  });
  return [...urls];
}

export function parseUrongdaYear(html: string, url: string): Candidate[] {
  const year = Number(new URL(url).pathname.match(/gaokao-(\d{4})$/)?.[1]);
  if (!Number.isInteger(year) || year < 1952) throw new Error(`Invalid ordinary-exam year URL: ${url}`);
  const $ = load(html);
  const candidates: Candidate[] = [];
  let series: string | null = null;
  let sourceSeries: string | null = null;
  let scope: Candidate['scope'] = null;
  let subject: string | null = null;
  let regions: string[] = [];
  $('h3,h4,p,li').each((_index, element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'h3') {
      sourceSeries = $(element).text().trim();
      series = normalizeSeries(sourceSeries);
      scope = inferSeries(sourceSeries).scope;
      subject = null;
      regions = inferSeries(sourceSeries).regions;
      const regionLabel = $(element).parent().find('span').filter((_n, item) => $(item).text().trim() === '适用省份').first();
      const listedRegions = regionLabel.next('span').text();
      if (listedRegions) regions = regionsInText(listedRegions);
      return;
    }
    if (tag === 'h4') {
      subject = $(element).text().trim() || null;
      return;
    }
    if (tag === 'p') {
      const text = $(element).text().trim();
      if (series && text.startsWith('适用省份')) regions = regionsInText(text);
      return;
    }
    if (!series || !subject) return;
    const anchor = $(element).find('a[href]').filter((_n, item) => /^https?:\/\//.test($(item).attr('href') ?? '')).first();
    const rawHref = anchor.attr('href');
    if (!rawHref) return;
    let resourceUrl: URL;
    try {
      resourceUrl = new URL(rawHref);
    } catch {
      return;
    }
    if (!['http:', 'https:'].includes(resourceUrl.protocol) || !resourceUrl.hostname) return;
    const href = resourceUrl.href;
    const filename = $(element).clone().find('a').remove().end().text().trim();
    const sourceClassification = classifyFile(filename);
    if (!sourceClassification) return;
    const normalizedSubject = normalizeSubject(subject) ?? subject;
    const titleRegions = regionsInText(filename);
    const elective = (titleRegions.length ? titleRegions : regions).length > 0
      && (titleRegions.length ? titleRegions : regions).every((region) => ELECTIVE_REGIONS.has(region));
    let subjectRole = normalizeSubjectRole(normalizedSubject, { elective });
    if (scope === 'national'
      && /全国(?:甲|乙|丙|A|B|C)卷|大纲|旧课程/iu.test(series)
      && TRADITIONAL_COMPONENT_SUBJECTS.has(normalizedSubject)) {
      subjectRole = 'integrated';
    }
    let candidateScope = scope;
    let candidateSeries = series;
    let candidateRegions = regions;
    let originType: OriginType = scope === 'national' ? 'national' : scope === 'regional' ? 'provincial' : 'unknown';
    let classification = sourceClassification;
    if (subjectRole !== 'unified' && subjectRole !== 'integrated' && titleRegions.length) {
      candidateRegions = titleRegions;
      candidateSeries = titleRegions.length === 1 ? `${titleRegions[0]}卷` : `${titleRegions.join('、')}卷`;
      candidateScope = 'regional';
      originType = titleRegions.length === 1
        ? 'provincial'
        : JOINT_EVIDENCE.test(`${sourceSeries ?? ''} ${filename}`) ? 'joint' : 'unknown';
      if (originType === 'unknown') classification = 'uncertain';
    } else if (candidateScope === 'national') {
      if (subjectRole === 'first_choice' || subjectRole === 'second_choice' || subjectRole === 'elective') {
        candidateScope = null;
        candidateRegions = [];
        originType = 'unknown';
        classification = 'uncertain';
      } else {
        const preset = seriesRegions(year, candidateSeries, subjectRole);
        if (preset.length) candidateRegions = preset;
      }
    } else if (candidateScope === 'regional' && candidateRegions.length > 1) {
      originType = JOINT_EVIDENCE.test(`${sourceSeries ?? ''} ${filename}`) ? 'joint' : 'unknown';
      if (originType === 'unknown') classification = 'uncertain';
    } else if (candidateScope === null) {
      classification = 'uncertain';
    }
    const inferredKind = normalizeResourceKind('', filename, href);
    const resourceKind = inferredKind === 'other' ? 'question' : inferredKind;
    const resourceLinkType = /网盘/u.test(anchor.text()) || /(?:^|\.)ctfile\.com$/iu.test(resourceUrl.hostname)
      ? 'drive'
      : 'source';
    const externalKey = `${year}:${sourceSeries ?? candidateSeries}:${normalizedSubject}:${filename}`;
    candidates.push({
      source_key: 'urongda', external_key: externalKey, title: filename, year,
      scope: candidateScope, series: candidateSeries, subject: normalizedSubject,
      regions_json: JSON.stringify(candidateRegions),
      format: fileFormat(filename), resource_url: href, source_url: url,
      resource_link_type: resourceLinkType,
      origin_type: originType, subject_role: subjectRole, resource_kind: resourceKind,
      classification,
      raw_json: JSON.stringify({
        year_page: url, source_series: sourceSeries, series: candidateSeries, subject: normalizedSubject,
        regions: candidateRegions, filename, href,
      }),
    });
  });
  return candidates;
}

export async function crawlUrongda(options: { fetcher?: typeof fetch; delayMs?: number } = {}): Promise<Candidate[]> {
  const fetcher = options.fetcher ?? fetch;
  const delayMs = options.delayMs ?? 800;
  const robotsCache = new Map<string, string>();
  const index = await fetchAllowedText(INDEX_URL, fetcher, {}, robotsCache);
  const results: Candidate[] = [];
  for (const url of discoverUrongdaYearUrls(index)) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    results.push(...parseUrongdaYear(await fetchAllowedText(url, fetcher, {}, robotsCache), url));
  }
  if (!results.length) throw new Error('urongda yielded no resource candidates; its page structure may have changed');
  return results;
}
