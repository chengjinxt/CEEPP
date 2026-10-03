import { describe, expect, it } from 'vitest';
import { runCrawl } from '../../src/crawl/cli';
import type { Candidate } from '../../src/crawl/types';

const candidate: Candidate = {
  source_key: 'gaokaomath', external_key: '普通高考/2025/2025北京.pdf',
  title: '2025北京.pdf', year: 2025, scope: 'regional', series: '北京卷',
  subject: '数学', regions_json: '["北京"]', format: 'PDF',
  resource_url: 'https://example.org/paper.pdf', source_url: 'https://example.org/source',
  classification: 'ordinary', raw_json: '{}',
};

describe('scheduled crawl orchestration', () => {
  it('stores successful source candidates and reports a failed source', async () => {
    const stored: Candidate[] = [];
    const summary = await runCrawl({
      github: async () => [candidate],
      urongda: async () => { throw new Error('robots denied'); },
      persist: async (items) => { stored.push(...items); return items.length; },
      dryRun: false,
    });
    expect(stored).toEqual([candidate]);
    expect(summary).toEqual({
      discovered: 1, stored: 1, bySource: { gaokaomath: 1, urongda: 0 },
      failures: ['urongda: robots denied'],
    });
  });

  it('does not write candidates during dry-run', async () => {
    const summary = await runCrawl({
      github: async () => [candidate], urongda: async () => [],
      persist: async () => { throw new Error('unexpected write'); },
      dryRun: true,
    });
    expect(summary).toEqual({
      discovered: 1, stored: 0, bySource: { gaokaomath: 1, urongda: 0 }, failures: [],
    });
  });
});
