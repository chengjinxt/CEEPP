import type { Candidate } from './types';
import { load } from 'cheerio';
import { fetchAllowedText } from './robots';
import {
  EXAM_REGIONS,
  normalizeRegion,
  normalizeResourceKind,
  normalizeSeries,
  normalizeSubject,
  normalizeSubjectRole,
  seriesRegions,
  type OriginType,
} from '@ceepp/shared/exam';

export const JHCEE_URL = 'https://www.jhcee.cn/pc/gk_information/consultation_detail-8ab0d407-8729-41a4-b5a9-8c5218881b03.html';

const ELECTIVE_REGIONS = new Set(['北京', '天津', '上海', '浙江', '山东', '海南']);
const JOINT_EVIDENCE = /联考|联合命题|共同命题|协作(?:体|组)/u;

function regionsInTitle(value: string): string[] {
  return EXAM_REGIONS.filter((region) => value.includes(region));
}

function subjectInTitle(value: string): string | null {
  const aliases = [
    '思想政治', '文科综合', '理科综合', '西班牙语', '生物学',
    '语文', '数学', '英语', '日语', '俄语', '德语', '法语', '物理', '历史',
    '化学', '地理', '政治', '生物', '文综', '理综', '外语',
  ];
  const found = aliases.find((name) => value.includes(name));
  return found ? normalizeSubject(found) : null;
}

function resourceFormat(title: string, url: string): string | null {
  const extension = `${title} ${new URL(url).pathname}`.match(/\.([a-z0-9]+)(?:\s|$)/iu)?.[1]?.toUpperCase();
  return extension && ['PDF', 'MP3', 'DOC', 'DOCX', 'ZIP', 'HTML', 'HTM'].includes(extension) ? extension : null;
}

function headingRegions(text: string): string[] {
  const normalized = text.trim().replace(/[省卷]$/u, '');
  const parts = normalized.split(/[\s、,，/]+/u).filter(Boolean);
  if (!parts.length) return [];
  const regions = parts.map(normalizeRegion);
  return regions.every(Boolean) ? regions as string[] : [];
}

export function parseJhcee(html: string, sourceUrl = JHCEE_URL): Candidate[] {
  const $ = load(html);
  const body = $('.gl-gkzx-detail-word').first();
  if (!body.length) return [];
  const yearText = `${$('.gl-gkzx-detail-title').first().text()} ${body.text()}`;
  const year = Number(yearText.match(/20\d{2}/u)?.[0]);
  if (!Number.isInteger(year)) return [];

  let section: 'unified' | 'selected' | null = null;
  let currentSeries: string | null = null;
  let currentRegions: string[] = [];
  let currentSubject: string | null = null;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  body.find('p').each((_index, paragraph) => {
    const element = $(paragraph);
    const paragraphText = element.text().replace(/\s+/gu, ' ').trim();
    const anchors = element.find('a[href]');
    if (!anchors.length) {
      if (/三大主科|统考科目/u.test(paragraphText)) {
        section = 'unified';
        currentSubject = null;
        return;
      }
      if (/选科科目|选择性考试/u.test(paragraphText)) {
        section = 'selected';
        currentSubject = null;
        return;
      }
      if (/^全国\s*[12一二ⅠⅡ]\s*卷$/u.test(paragraphText)) {
        currentSeries = normalizeSeries(paragraphText);
        currentRegions = [];
        currentSubject = null;
        return;
      }
      if (/^自主命题$/u.test(paragraphText)) {
        currentSeries = null;
        currentRegions = [];
        currentSubject = null;
        return;
      }
      const regions = headingRegions(paragraphText);
      if (regions.length) {
        currentRegions = regions;
        currentSeries = regions.length === 1 ? `${regions[0]}卷` : `${paragraphText.replace(/[省卷]$/u, '')}卷`;
        currentSubject = null;
        return;
      }
      const subject = normalizeSubject(paragraphText);
      if (subject) currentSubject = subject;
      return;
    }

    anchors.each((_anchorIndex, anchor) => {
      const rawHref = $(anchor).attr('href');
      if (!rawHref) return;
      let resourceUrl: string;
      try {
        resourceUrl = new URL(rawHref, sourceUrl).href;
      } catch {
        return;
      }
      if (!/^https?:\/\//iu.test(resourceUrl) || seen.has(resourceUrl)) return;
      const title = ($(anchor).attr('title') || $(anchor).text()).replace(/\s+/gu, ' ').trim();
      const label = paragraphText.slice(0, Math.max(0, paragraphText.indexOf($(anchor).text()))).trim();
      const resourceKind = normalizeResourceKind(label, title, resourceUrl);
      const format = resourceFormat(title, resourceUrl);
      if (resourceKind === 'other' || !format) return;

      const subject = subjectInTitle(title) ?? currentSubject;
      const titleRegions = regionsInTitle(title);
      const localRegions = titleRegions.length ? titleRegions : currentRegions;
      const titleSeriesMatch = title.match(/(?:全国|新高考|新课标)\s*[12一二ⅠⅡ]\s*卷?/u)?.[0];
      let series = titleSeriesMatch ? normalizeSeries(titleSeriesMatch) : currentSeries;
      let regions = localRegions;
      let originType: OriginType = 'unknown';

      if (section === 'selected' && localRegions.length) {
        series = localRegions.length === 1
          ? `${localRegions[0]}卷`
          : currentSeries && !/^全国/u.test(currentSeries) ? currentSeries : `${localRegions.join('、')}卷`;
        originType = localRegions.length === 1
          ? 'provincial'
          : JOINT_EVIDENCE.test(`${currentSeries ?? ''} ${title}`) ? 'joint' : 'unknown';
      } else if (series && /^全国/u.test(series)) {
        originType = 'national';
      } else if (localRegions.length) {
        originType = localRegions.length === 1
          ? 'provincial'
          : JOINT_EVIDENCE.test(`${currentSeries ?? ''} ${title}`) ? 'joint' : 'unknown';
      }

      const subjectRole = subject
        ? normalizeSubjectRole(subject, {
            elective: section === 'selected' && localRegions.length > 0
              && localRegions.every((region) => ELECTIVE_REGIONS.has(region)),
          })
        : 'other';
      if (originType === 'national' && series) regions = seriesRegions(year, series, subjectRole);

      seen.add(resourceUrl);
      candidates.push({
        source_key: 'jhcee',
        external_key: resourceUrl,
        title,
        year,
        scope: originType === 'national' ? 'national' : originType === 'unknown' ? null : 'regional',
        series,
        subject,
        regions_json: JSON.stringify(regions),
        format,
        resource_url: resourceUrl,
        resource_link_type: 'source',
        source_url: sourceUrl,
        origin_type: originType,
        subject_role: subjectRole,
        resource_kind: resourceKind,
        classification: originType === 'unknown' || !subject ? 'uncertain' : 'ordinary',
        raw_json: JSON.stringify({ label, section, series, regions, title, href: resourceUrl }),
      });
    });
  });
  return candidates;
}

export async function crawlJhcee(options: { fetcher?: typeof fetch } = {}): Promise<Candidate[]> {
  const html = await fetchAllowedText(JHCEE_URL, options.fetcher ?? fetch);
  const candidates = parseJhcee(html, JHCEE_URL);
  if (!candidates.length) throw new Error('JHCEE yielded no resource candidates; its page structure may have changed');
  return candidates;
}
