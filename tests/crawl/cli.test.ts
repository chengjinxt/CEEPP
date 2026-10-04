import { describe, expect, it } from 'vitest';
import { runCrawl } from '../../src/crawl/cli';
import type { Candidate } from '../../src/crawl/types';

const candidate: Candidate = {
  source_key: 'gaokaomath', external_key: '普通高考/2025/2025北京.pdf',
  title: '2025北京.pdf', year: 2025, scope: 'regional', series: '北京卷',
  subject: '数学', regions_json: '["北京"]', format: 'PDF',
  resource_url: 'https://example.org/paper.pdf', source_url: 'https://example.org/source',
  resource_link_type: 'source',
  origin_type: 'provincial', subject_role: 'unified', resource_kind: 'question',
  classification: 'ordinary', raw_json: '{}',
};

describe('scheduled crawl orchestration', () => {
  it('stores successful source candidates and reports a failed source', async () => {
    const stored: Candidate[] = [];
    const summary = await runCrawl({
      github: async () => [candidate],
      urongda: async () => { throw new Error('robots denied'); },
      jhcee: async () => [{ ...candidate, source_key: 'jhcee', external_key: 'jhcee-paper' }],
      persist: async (items) => { stored.push(...items); return items.length; },
      dryRun: false,
    });
    expect(stored).toEqual([candidate, { ...candidate, source_key: 'jhcee', external_key: 'jhcee-paper' }]);
    expect(summary).toEqual({
      discovered: 2, stored: 2, bySource: { gaokaomath: 1, urongda: 0, jhcee: 1 },
      failures: ['urongda: robots denied'],
    });
  });

  it('does not write candidates during dry-run', async () => {
    const summary = await runCrawl({
      github: async () => [candidate], urongda: async () => [],
      jhcee: async () => [],
      persist: async () => { throw new Error('unexpected write'); },
      dryRun: true,
    });
    expect(summary).toEqual({
      discovered: 1, stored: 0, bySource: { gaokaomath: 1, urongda: 0, jhcee: 0 }, failures: [],
    });
  });
});
