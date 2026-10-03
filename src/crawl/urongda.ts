import type { Candidate } from './types';
import { load } from 'cheerio';
import { classifyFile, fileFormat, inferSeries, regionsInText } from './classify';
import { fetchAllowedText } from './robots';

const INDEX_URL = 'https://t.urongda.com/exams';

export function discoverUrongdaYearUrls(html: string): string[] {
  const $ = load(html);
  const urls = new Set<string>();
  $('a[href]').each((_index, link) => {
    const url = new URL($(link).attr('href')!, INDEX_URL);
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
  let scope: Candidate['scope'] = null;
  let subject: string | null = null;
  let regions: string[] = [];
  $('h3,h4,p,li').each((_index, element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'h3') {
      series = $(element).text().trim();
      scope = inferSeries(series).scope;
      subject = null;
      regions = inferSeries(series).regions;
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
    if (!series || !subject || !scope) return;
    const anchor = $(element).find('a[href]').filter((_n, item) => /^https?:\/\//.test($(item).attr('href') ?? '')).first();
    const href = anchor.attr('href');
    if (!href) return;
    const filename = $(element).clone().find('a').remove().end().text().trim();
    const classification = classifyFile(filename);
    if (!classification) return;
    const externalKey = `${year}:${series}:${subject}:${filename}`;
    candidates.push({
      source_key: 'urongda', external_key: externalKey, title: filename, year,
      scope, series, subject, regions_json: JSON.stringify(regions),
      format: fileFormat(filename), resource_url: href, source_url: url,
      classification,
      raw_json: JSON.stringify({ year_page: url, series, subject, filename, href }),
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
  return results;
}
