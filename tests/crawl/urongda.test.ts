import { describe, expect, it } from 'vitest';
import { regionsInText } from '../../src/crawl/classify';
import { crawlUrongda, discoverUrongdaYearUrls, parseUrongdaYear } from '../../src/crawl/urongda';

describe('urongda ordinary exam pages', () => {
  it('discovers available years from the index without hard-coding their range', () => {
    const html = `<main>
      <a href="https://">损坏年份入口</a>
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
      resource_link_type: 'drive',
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

  it('does not infer the authoring authority from multi-region usage and keeps traditional components distinct', () => {
    const html = `<main>
      <div><h3>全国甲卷</h3><div><span>适用省份</span><span>四川、云南</span></div></div>
      <h4>物理</h4><ul><li>2024全国甲卷物理试题.pdf <a href="https://files.example/traditional">下载</a></li></ul>
      <div><h3>新高考Ⅰ卷</h3><div><span>适用省份</span><span>广东、福建</span></div></div>
      <h4>物理</h4><ul>
        <li>2024新高考Ⅰ卷物理试题.pdf <a href="https://files.example/unknown-origin">下载</a></li>
        <li>2024广东、福建高考物理试题.pdf <a href="https://files.example/multi-region">下载</a></li>
      </ul>
    </main>`;
    const candidates = parseUrongdaYear(html, 'https://t.urongda.com/exams/gaokao-2024');

    expect(candidates[0]).toMatchObject({
      series: '全国甲卷', scope: 'national', origin_type: 'national',
      subject_role: 'integrated', classification: 'ordinary',
    });
    expect(candidates[1]).toMatchObject({
      series: '全国一卷', scope: null, origin_type: 'unknown',
      subject_role: 'first_choice', classification: 'uncertain',
    });
    expect(candidates[2]).toMatchObject({
      series: '广东、福建卷', scope: 'regional', origin_type: 'unknown',
      subject_role: 'first_choice', classification: 'uncertain',
    });
    expect(JSON.parse(candidates[2]!.regions_json)).toEqual(['广东', '福建']);
  });

  it('accepts only the 31 supported province-level regions', () => {
    expect(regionsInText('北京、香港、台湾、广西')).toEqual(['北京', '广西']);
  });

  it('skips malformed absolute resource URLs without aborting the year page', () => {
    const html = `<main>
      <h3>北京卷</h3><h4>数学</h4><ul>
        <li>损坏链接试卷.pdf <a href="https://">网盘下载</a></li>
        <li>有效试卷.pdf <a href="https://files.example/valid.pdf">下载</a></li>
      </ul>
    </main>`;
    const candidates = parseUrongdaYear(html, 'https://t.urongda.com/exams/gaokao-2025');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.resource_url).toBe('https://files.example/valid.pdf');
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

  it('fails loudly when the source no longer exposes any ordinary-exam candidates', async () => {
    const fakeFetch: typeof fetch = async (input) => String(input).endsWith('/robots.txt')
      ? new Response('', { status: 404 })
      : new Response('<main>页面结构已改变</main>');

    await expect(crawlUrongda({ fetcher: fakeFetch, delayMs: 0 })).rejects.toThrow(/no resource candidates/i);
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
