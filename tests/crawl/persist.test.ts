import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { isRobotsAllowed } from '../../src/crawl/robots';
import { upsertCandidates } from '../../src/crawl/persist';
import type { Candidate } from '../../src/crawl/types';

const initialMigration = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');
const taxonomyMigration = readFileSync(new URL('../../migrations/0002_taxonomy_and_uploads.sql', import.meta.url), 'utf8');

describe('crawler safeguards', () => {
  it('honors the longest applicable robots.txt rule', () => {
    const robots = `User-agent: *\nDisallow: /exams/\nAllow: /exams/public/\nUser-agent: ceepp-crawler\nDisallow: /secret/`;
    expect(isRobotsAllowed(robots, '/exams/gaokao-2025', 'other-bot')).toBe(false);
    expect(isRobotsAllowed(robots, '/exams/public/2025', 'other-bot')).toBe(true);
    expect(isRobotsAllowed(robots, '/secret/page', 'ceepp-crawler')).toBe(false);
  });

  it('respects an end-anchored robots.txt path', () => {
    const robots = 'User-agent: *\nDisallow: /exams/private$';
    expect(isRobotsAllowed(robots, '/exams/private', 'ceepp-crawler')).toBe(false);
    expect(isRobotsAllowed(robots, '/exams/private/child', 'ceepp-crawler')).toBe(true);
  });

  it('sends parameterized D1 upserts without changing the review decision or linked paper', async () => {
    const candidate: Candidate = {
      source_key: 'gaokaomath', external_key: '普通高考/2025/2025北京.pdf',
      title: '2025北京.pdf', year: 2025, scope: 'regional', series: '北京卷',
      subject: '数学', regions_json: '["北京"]', format: 'PDF',
      resource_url: 'https://example.org/paper.pdf', source_url: 'https://example.org/source',
      resource_link_type: 'drive',
      origin_type: 'provincial', subject_role: 'unified', resource_kind: 'question',
      classification: 'ordinary', raw_json: '{"path":"普通高考/2025/2025北京.pdf"}',
    };
    let request: Request | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      request = new Request(input, init);
      return Response.json({ success: true, result: [{ success: true }] });
    };

    expect(await upsertCandidates([candidate], {
      accountId: 'account', databaseId: 'database', apiToken: 'secret', fetcher: fakeFetch,
    })).toBe(1);
    expect(request?.url).toBe('https://api.cloudflare.com/client/v4/accounts/account/d1/database/database/query');
    const body = await request!.json() as { batch: Array<{ sql: string; params: string[] }> };
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0]!.params).toContain('2025北京.pdf');
    expect(body.batch[0]!.params).toContain('provincial');
    expect(body.batch[0]!.params).toContain('unified');
    expect(body.batch[0]!.params).toContain('question');
    expect(body.batch[0]!.params).toContain('drive');
    expect(body.batch[0]!.params).not.toContain('secret');
    expect(body.batch[0]!.sql).toContain('ON CONFLICT(source_key, external_key) DO UPDATE');
    expect(body.batch[0]!.sql).toMatch(/origin_type, subject_role, resource_kind,\s*resource_link_type/);
    expect(body.batch[0]!.sql).not.toMatch(/review_status\s*=/);
    expect(body.batch[0]!.sql).not.toMatch(/paper_id\s*=/);

    const database = new DatabaseSync(':memory:');
    try {
      database.exec(initialMigration);
      database.exec(taxonomyMigration);
      database.prepare(body.batch[0]!.sql).run(...body.batch[0]!.params);
      expect(database.prepare(`
        SELECT source_key, external_key, resource_link_type, raw_json
        FROM candidates
      `).get()).toMatchObject({
        source_key: 'gaokaomath',
        external_key: '普通高考/2025/2025北京.pdf',
        resource_link_type: 'drive',
        raw_json: '{"path":"普通高考/2025/2025北京.pdf"}',
      });
    } finally {
      database.close();
    }
  });
});
