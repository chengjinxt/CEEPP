import { describe, expect, it } from 'vitest';
import { crawlUrongda, discoverUrongdaYearUrls, parseUrongdaYear } from '../../src/crawl/urongda';

describe('urongda ordinary exam pages', () => {
  it('discovers available years from the index without hard-coding their range', () => {
    const html = `<main>
      <a href="/exams/gaokao-2025">2025普通高考</a>
      <a href="/exams/gaokao-2024">2024普通高考</a>
      <a href="/exams/chunji-2025">2025春季高考</a>
      <a href="/exams/gaokao-2025">重复入口</a>
    </main>`;
    expect(discoverUrongdaYearUrls(html)).toEqual([
      'https://t.urongda.com/exams/gaokao-2025',
      'https://t.urongda.com/exams/gaokao-2024',
    ]);
  });

  it('extracts files by paper series and subject while separating doubtful and excluded material', () => {
    const html = `<main>
      <h1>2025 年各省份高考试卷类型汇总</h1>
      <div><h3>全国一卷</h3><div><span>适用省份</span><span><span>山东省</span><span>广东省</span></span></div></div>
      <h4>数学</h4><ul>
        <li>2025全国1(山东,广东).pdf <a href="https://url90.ctfile.com/f/1">网盘下载</a></li>
        <li>2025年高考数学真题及答案.zip <a href="https://url90.ctfile.com/f/2">网盘下载</a></li>
        <li>2025年数学参考答案.pdf <a href="https://url90.ctfile.com/f/3">网盘下载</a></li>
      </ul>
      <div><h3>上海卷</h3><div><span>适用省份</span><span><span>上海市</span></span></div></div><h4>数学</h4><ul>
        <li>2025春季上海.pdf <a href="https://url90.ctfile.com/f/4">网盘下载</a></li>
        <li>2025上海.pdf <a href="https://url90.ctfile.com/f/5">网盘下载</a></li>
      </ul>
      <div><h3>全国二卷</h3><div><span>适用省份</span><span><span>辽宁省</span><span>四川省</span></span></div></div><h4>物理</h4><ul>
        <li>2025四川高考物理试卷.pdf <a href="https://url90.ctfile.com/f/6">网盘下载</a></li>
      </ul>
    </main>`;
    const candidates = parseUrongdaYear(html, 'https://t.urongda.com/exams/gaokao-2025');

    expect(candidates).toHaveLength(4);
    expect(candidates.map((c) => c.classification)).toEqual(['ordinary', 'uncertain', 'ordinary', 'ordinary']);
    expect(candidates.map((c) => c.resource_kind)).toEqual([
      'question', 'question_with_answer', 'question', 'question',
    ]);
    expect(candidates[0]).toMatchObject({
      source_key: 'urongda',
      year: 2025,
      scope: 'national',
      series: '全国一卷',
      subject: '数学',
      format: 'PDF',
      resource_url: 'https://url90.ctfile.com/f/1',
      source_url: 'https://t.urongda.com/exams/gaokao-2025',
      origin_type: 'national',
      subject_role: 'unified',
    });
    expect(JSON.parse(candidates[0]!.regions_json)).toEqual([
      '浙江', '江苏', '山东', '广东', '河北', '福建', '湖北', '湖南', '河南', '江西', '安徽',
    ]);
    expect(candidates[2]).toMatchObject({
      scope: 'regional', series: '上海卷', origin_type: 'provincial', subject_role: 'unified',
    });
    expect(candidates[3]).toMatchObject({
      scope: 'regional', series: '四川卷', subject: '物理',
      origin_type: 'provincial', subject_role: 'first_choice',
    });
    expect(JSON.parse(candidates[3]!.regions_json)).toEqual(['四川']);
  });

  it('stops before the index if robots.txt denies the path', async () => {
    const seen: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /exams', { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    await expect(crawlUrongda({ fetcher: fakeFetch, delayMs: 0 })).rejects.toThrow(/robots/i);
    expect(seen).toEqual(['https://t.urongda.com/robots.txt']);
  });

  it('reuses robots.txt while visiting discovered years at the configured pace', async () => {
    const seen: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.endsWith('/exams')) return new Response('<a href="/exams/gaokao-2025">2025普通高考</a><a href="/exams/gaokao-2024">2024普通高考</a>');
      return new Response('<h3>北京卷</h3><h4>数学</h4><li>北京数学试卷.pdf <a href="https://example.org/paper.pdf">网盘下载</a></li>');
    };

    const candidates = await crawlUrongda({ fetcher: fakeFetch, delayMs: 0 });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.year)).toEqual([2025, 2024]);
    expect(seen).toEqual([
      'https://t.urongda.com/robots.txt',
      'https://t.urongda.com/exams',
      'https://t.urongda.com/exams/gaokao-2025',
      'https://t.urongda.com/exams/gaokao-2024',
    ]);
  });
});
