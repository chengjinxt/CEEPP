import { describe, expect, it } from 'vitest';
import { parseGitHubTree } from '../../src/crawl/github';

describe('gaokaomath tree', () => {
  it('keeps ordinary mathematics papers with their original download and attribution URLs', () => {
    const candidates = parseGitHubTree({
      truncated: false,
      tree: [
        { type: 'blob', path: '普通高考/2025/2025全国1(山东,广东).pdf', sha: 'a1' },
        { type: 'blob', path: '普通高考/2012/2012上海文.pdf', sha: 'a2' },
        { type: 'blob', path: '春季高考/2025/2025春季上海.pdf', sha: 'a3' },
        { type: 'blob', path: '普通高考/2025/2025全国1参考答案.pdf', sha: 'a4' },
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      source_key: 'gaokaomath',
      external_key: '普通高考/2025/2025全国1(山东,广东).pdf',
      title: '2025全国1(山东,广东).pdf',
      year: 2025,
      scope: 'national',
      series: '全国一卷',
      subject: '数学',
      classification: 'ordinary',
      format: 'PDF',
    });
    expect(JSON.parse(candidates[0]!.regions_json)).toEqual(['山东', '广东']);
    expect(candidates[0]!.resource_url).toBe(
      'https://raw.githubusercontent.com/deekur/gaokaomath/main/%E6%99%AE%E9%80%9A%E9%AB%98%E8%80%83/2025/2025%E5%85%A8%E5%9B%BD1(%E5%B1%B1%E4%B8%9C%2C%E5%B9%BF%E4%B8%9C).pdf',
    );
    expect(candidates[0]!.source_url).toContain('github.com/deekur/gaokaomath/blob/main/');
    expect(candidates[1]).toMatchObject({ scope: 'regional', series: '上海卷', year: 2012 });
  });

  it('fails when GitHub truncates the tree rather than silently losing papers', () => {
    expect(() => parseGitHubTree({ truncated: true, tree: [] })).toThrow(/truncated/i);
  });
});
