import { describe, expect, it } from 'vitest';
import { crawlJhcee, JHCEE_URL, parseJhcee } from '../../src/crawl/jhcee';

const article = `<main>
  <a href="https://example.org/navigation.pdf">导航附件</a>
  <div class="gl-gkzx-detail-title">【高考真题】2026年全国高考试题及答案汇总</div>
  <div class="gl-gkzx-detail-word">
    <p>全国一卷：浙江、江苏、山东、广东、河北、福建、湖北、湖南、河南、江西、安徽</p>
    <p>全国二卷：辽宁、重庆、海南、山西、云南、贵州、黑龙江、吉林、甘肃、广西、西藏、新疆、四川、陕西、内蒙古、宁夏、青海</p>
    <p><strong>一、三大主科试卷及答案</strong></p>
    <p><strong>全国一卷</strong></p>
    <p><strong>语文</strong></p>
    <p>试卷：<a href="https://files.example/one-chinese.pdf">2026年全国高考语文试卷（全国一卷）.pdf</a></p>
    <p>答案：<a href="https://files.example/one-chinese-answer.pdf">2026年全国高考语文答案（全国一卷）.pdf</a></p>
    <p><strong>外语</strong></p>
    <p>听力：<a href="https://files.example/one-listening.mp3">2026年全高考英语听力（全国一卷）.mp3</a></p>
    <p>答案：<a href="https://files.example/one-analysis.pdf">2026年全国高考英语解析（全国一卷）.pdf</a></p>
    <p><strong>全国二卷</strong></p>
    <p><strong>数学</strong></p>
    <p>试卷：<a href="https://files.example/two-math.pdf">2026年全国高考数学试卷（全国二卷）.pdf</a></p>
    <p><strong>二、选科科目试卷及答案</strong></p>
    <p><strong>全国二卷</strong></p>
    <p><strong>四川省</strong></p>
    <p>试卷：<a href="https://files.example/sichuan-physics.pdf">2026年四川高考物理试卷.pdf</a></p>
    <p>答案：<a href="https://files.example/sichuan-chemistry-answer.pdf">2026年四川高考化学答案.pdf</a></p>
    <p>答案：<a href="https://files.example/sichuan-chemistry-answer.pdf">重复链接.pdf</a></p>
  </div>
</main>`;

describe('JHCEE fixed annual resource page', () => {
  it('classifies every unique linked paper, answer, analysis, and listening resource', () => {
    const candidates = parseJhcee(article);

    expect(candidates).toHaveLength(7);
    expect(candidates.map((item) => item.resource_kind)).toEqual([
      'question', 'answer', 'listening_audio', 'analysis', 'question', 'question', 'answer',
    ]);
    expect(candidates[0]).toMatchObject({
      source_key: 'jhcee', year: 2026, scope: 'national', series: '全国一卷',
      subject: '语文', origin_type: 'national', subject_role: 'unified', format: 'PDF',
      resource_url: 'https://files.example/one-chinese.pdf', source_url: JHCEE_URL,
    });
    expect(JSON.parse(candidates[0]!.regions_json)).toEqual([
      '浙江', '江苏', '山东', '广东', '河北', '福建', '湖北', '湖南', '河南', '江西', '安徽',
    ]);
    expect(JSON.parse(candidates[4]!.regions_json)).toHaveLength(17);
  });

  it('keeps Sichuan selected subjects provincial instead of inheriting the national-two regions', () => {
    const candidates = parseJhcee(article);
    const physics = candidates.find((item) => item.title.includes('四川高考物理'))!;
    const chemistryAnswer = candidates.find((item) => item.title.includes('四川高考化学'))!;

    expect(physics).toMatchObject({
      scope: 'regional', series: '四川卷', subject: '物理',
      origin_type: 'provincial', subject_role: 'first_choice', resource_kind: 'question',
    });
    expect(JSON.parse(physics.regions_json)).toEqual(['四川']);
    expect(chemistryAnswer).toMatchObject({
      series: '四川卷', subject: '化学', subject_role: 'second_choice',
      resource_kind: 'answer',
    });
  });

  it('does not treat multiple applicable regions as proof of joint authoring', () => {
    const multiRegionArticle = `<div class="gl-gkzx-detail-title">2026 年普通高考</div>
      <div class="gl-gkzx-detail-word">
        <p>二、选科科目试卷及答案</p>
        <p>湖北、湖南</p><p>化学</p>
        <p>试卷：<a href="https://files.example/multi.pdf">2026年湖北湖南高考化学试卷.pdf</a></p>
        <p>试卷：<a href="https://files.example/joint.pdf">2026年湖北湖南联考化学试卷.pdf</a></p>
      </div>`;
    const [applicable, explicitJoint] = parseJhcee(multiRegionArticle);

    expect(applicable).toMatchObject({
      scope: null, origin_type: 'unknown', subject_role: 'second_choice', classification: 'uncertain',
    });
    expect(JSON.parse(applicable!.regions_json)).toEqual(['湖北', '湖南']);
    expect(explicitJoint).toMatchObject({
      scope: 'regional', origin_type: 'joint', subject_role: 'second_choice', classification: 'ordinary',
    });
  });

  it('does not infer joint authoring from multiple regions in the unified section', () => {
    const multiRegionArticle = `<div class="gl-gkzx-detail-title">2026 年普通高考</div>
      <div class="gl-gkzx-detail-word">
        <p>一、统考科目试卷及答案</p>
        <p>湖北、湖南</p><p>数学</p>
        <p>试卷：<a href="https://files.example/unified-multi.pdf">2026年湖北湖南高考数学试卷.pdf</a></p>
      </div>`;
    const [candidate] = parseJhcee(multiRegionArticle);

    expect(candidate).toMatchObject({
      scope: null, origin_type: 'unknown', subject_role: 'unified', classification: 'uncertain',
    });
    expect(JSON.parse(candidate!.regions_json)).toEqual(['湖北', '湖南']);
  });

  it('fetches only the fixed supplied page after its robots policy', async () => {
    const seen: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url === JHCEE_URL) return new Response(article);
      throw new Error(`Unexpected request: ${url}`);
    };

    await expect(crawlJhcee({ fetcher: fakeFetch })).resolves.toHaveLength(7);
    expect(seen).toEqual(['https://www.jhcee.cn/robots.txt', JHCEE_URL]);
  });

  it('fails loudly when the supplied page no longer yields any resource candidates', async () => {
    const fakeFetch: typeof fetch = async (input) => String(input).endsWith('/robots.txt')
      ? new Response('', { status: 404 })
      : new Response('<div class="gl-gkzx-detail-title">2026 年普通高考</div><main>页面结构已改变</main>');

    await expect(crawlJhcee({ fetcher: fakeFetch })).rejects.toThrow(/no resource candidates/i);
  });
});
