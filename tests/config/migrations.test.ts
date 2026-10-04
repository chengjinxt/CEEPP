import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const initialMigration = readFileSync(
  new URL('../../migrations/0001_init.sql', import.meta.url),
  'utf8',
);
const taxonomyAndUploadsMigration = readFileSync(
  new URL('../../migrations/0002_taxonomy_and_uploads.sql', import.meta.url),
  'utf8',
);

function plainRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

describe('D1 migration upgrades', () => {
  it('preserves v1 data and applies taxonomy, upload constraints, and durable cleanup triggers', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec(initialMigration);
      database.exec(`
        INSERT INTO papers (id, title, year, scope, series, subject, status)
        VALUES
          (101, '2023 年全国甲卷语文', 2023, 'national', '全国甲卷', '语文', 'published'),
          (102, '2023 年浙江卷数学', 2023, 'regional', '浙江卷', '数学', 'draft'),
          (103, '2023 年多地区生物试卷', 2023, 'regional', '地区卷', '生物', 'draft');

        INSERT INTO paper_regions (paper_id, region)
        VALUES
          (101, '四川'), (101, '云南'), (102, '浙江'),
          (103, '北京市'), (103, '四川'), (103, '北京'),
          (103, '广西壮族自治区'), (103, '台湾');

        INSERT INTO resources
          (id, paper_id, format, url, link_type, source_name, source_url, access_code, verified_at)
        VALUES
          (201, 101, 'PDF', 'https://example.com/2023-a.pdf', 'source',
           '旧资料站', 'https://example.com/source', 'abcd', '2026-10-01'),
          (202, 102, 'PDF', 'https://files.example.com/legacy-drive', 'source',
           'urongda', 'https://t.urongda.com/exams/gaokao-2023', NULL, '2026-10-01'),
          (203, 102, 'HTML', 'https://share.ctfile.com/f/legacy', 'source',
           'other-source', 'https://example.com/source', NULL, '2026-10-01');

        INSERT INTO candidates
          (id, source_key, external_key, title, year, scope, series, subject, regions_json,
           format, resource_url, source_url, classification, raw_json, review_status, paper_id)
        VALUES
          (301, 'legacy-source', 'legacy-2023-a', '2023 年全国甲卷语文', 2023,
           'national', '全国甲卷', '语文', '["四川","云南"]', 'PDF',
           'https://example.com/2023-a.pdf', 'https://example.com/source', 'ordinary',
           '{"legacy":true}', 'approved', 101),
          (302, 'legacy-source', 'legacy-2023-zj', '2023 年浙江卷数学', 2023,
           'regional', '浙江卷', '数学', '["浙江"]', 'PDF',
           'https://example.com/2023-zj.pdf', 'https://example.com/source', 'uncertain',
           '{}', 'pending', NULL),
          (303, 'legacy-source', 'legacy-2023-multi', '2023 年多地区政治试卷', 2023,
           'regional', '地区卷', '政治', '["北京市","北京","广西壮族自治区","台湾"]', 'PDF',
           'https://example.com/2023-multi.pdf', 'https://example.com/source', 'uncertain',
           '{}', 'pending', NULL),
          (304, 'urongda', 'legacy-2023-drive', '2023 年网盘试卷', 2023,
           'regional', '浙江卷', '数学', '["浙江省"]', 'PDF',
           'https://files.example.com/legacy-drive', 'https://t.urongda.com/exams/gaokao-2023', 'ordinary',
           '{}', 'pending', NULL),
          (305, 'other-source', 'legacy-2023-ctfile', '2023 年其他网盘试卷', 2023,
           'regional', '浙江卷', '数学', '["浙江"]', 'PDF',
           'https://share.ctfile.com/f/candidate', 'https://example.com/source', 'ordinary',
           '{}', 'pending', NULL);
      `);

      database.exec(taxonomyAndUploadsMigration);

      const papers = plainRows(database.prepare(`
        SELECT id, title, subject, origin_type, subject_role
        FROM papers
        ORDER BY id
      `).all() as Array<{
        id: number;
        title: string;
        origin_type: string;
        subject: string;
        subject_role: string;
      }>);
      expect(papers).toEqual([
        {
          id: 101,
          title: '2023 年全国甲卷语文',
          subject: '语文',
          origin_type: 'national',
          subject_role: 'other',
        },
        {
          id: 102,
          title: '2023 年浙江卷数学',
          subject: '数学',
          origin_type: 'unknown',
          subject_role: 'other',
        },
        {
          id: 103,
          title: '2023 年多地区生物试卷',
          subject: '生物学',
          origin_type: 'unknown',
          subject_role: 'other',
        },
      ]);

      const regions = plainRows(database.prepare(`
        SELECT paper_id, region
        FROM paper_regions
        ORDER BY paper_id, rowid
      `).all() as Array<{ paper_id: number; region: string }>);
      expect(regions).toEqual([
        { paper_id: 101, region: '四川' },
        { paper_id: 101, region: '云南' },
        { paper_id: 102, region: '浙江' },
        { paper_id: 103, region: '北京' },
        { paper_id: 103, region: '四川' },
        { paper_id: 103, region: '广西' },
      ]);

      const migratedResource = database.prepare(`
        SELECT id, paper_id, format, kind, storage_type, url, link_type, source_name,
               source_url, access_code, verified_at, storage_key, filename, mime_type, size_bytes
        FROM resources
        WHERE id = 201
      `).get() as Record<string, unknown> | undefined;
      expect(migratedResource === undefined ? undefined : { ...migratedResource }).toEqual({
        id: 201,
        paper_id: 101,
        format: 'PDF',
        kind: 'question',
        storage_type: 'external',
        url: 'https://example.com/2023-a.pdf',
        link_type: 'source',
        source_name: '旧资料站',
        source_url: 'https://example.com/source',
        access_code: 'abcd',
        verified_at: '2026-10-01',
        storage_key: null,
        filename: null,
        mime_type: null,
        size_bytes: null,
      });
      expect(plainRows(database.prepare('SELECT id, link_type FROM resources WHERE id IN (202, 203) ORDER BY id').all() as Array<{ id: number; link_type: string }>)).toEqual([
        { id: 202, link_type: 'drive' },
        { id: 203, link_type: 'drive' },
      ]);

      const candidates = plainRows(database.prepare(`
        SELECT id, subject, regions_json, origin_type, subject_role, resource_kind, resource_link_type
        FROM candidates
        ORDER BY id
      `).all() as Array<{
        id: number;
        subject: string;
        regions_json: string;
        origin_type: string;
        subject_role: string;
        resource_kind: string;
        resource_link_type: string;
      }>);
      expect(candidates).toEqual([
        { id: 301, subject: '语文', regions_json: '["四川","云南"]', origin_type: 'national', subject_role: 'other', resource_kind: 'question', resource_link_type: 'source' },
        { id: 302, subject: '数学', regions_json: '["浙江"]', origin_type: 'unknown', subject_role: 'other', resource_kind: 'question', resource_link_type: 'source' },
        { id: 303, subject: '思想政治', regions_json: '["北京","广西"]', origin_type: 'unknown', subject_role: 'other', resource_kind: 'question', resource_link_type: 'source' },
        { id: 304, subject: '数学', regions_json: '["浙江"]', origin_type: 'unknown', subject_role: 'other', resource_kind: 'question', resource_link_type: 'drive' },
        { id: 305, subject: '数学', regions_json: '["浙江"]', origin_type: 'unknown', subject_role: 'other', resource_kind: 'question', resource_link_type: 'drive' },
      ]);

      const quarantinedRegions = plainRows(database.prepare(`
        SELECT entity_type, entity_id, raw_region
        FROM legacy_region_review
        ORDER BY entity_type, entity_id, raw_region
      `).all() as Array<{ entity_type: string; entity_id: number; raw_region: string }>);
      expect(quarantinedRegions).toEqual([
        { entity_type: 'candidate', entity_id: 303, raw_region: '台湾' },
        { entity_type: 'paper', entity_id: 103, raw_region: '台湾' },
      ]);

      database.exec(`
        INSERT INTO r2_cleanup_queue (storage_key, size_bytes, reason)
        VALUES ('papers/102/preview.pdf', 2048, 'upload_pending');

        INSERT INTO resources
          (paper_id, format, kind, storage_type, storage_key, filename, mime_type, size_bytes, etag)
        VALUES
          (102, 'PDF', 'question', 'upload', 'papers/102/preview.pdf',
           '浙江卷数学.pdf', 'application/pdf', 2048, 'etag-1');
      `);

      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM r2_cleanup_queue
        WHERE storage_key = 'papers/102/preview.pdf'
      `).get()).toMatchObject({ count: 0 });

      expect(() => database.exec(`
        INSERT INTO resources
          (paper_id, format, kind, storage_type, url, link_type, storage_key,
           filename, mime_type, size_bytes)
        VALUES
          (102, 'PDF', 'question', 'upload', 'https://example.com/not-an-upload.pdf',
           'source', 'papers/102/invalid.pdf', 'invalid.pdf', 'application/pdf', 10);
      `)).toThrow();

      database.exec(`
        DELETE FROM resources
        WHERE storage_key = 'papers/102/preview.pdf';
      `);

      const cleanupItem = database.prepare(`
        SELECT storage_key, size_bytes, reason, attempts, claimed_at, last_error
        FROM r2_cleanup_queue
        WHERE storage_key = 'papers/102/preview.pdf'
      `).get() as Record<string, unknown> | undefined;
      expect(cleanupItem === undefined ? undefined : { ...cleanupItem }).toEqual({
        storage_key: 'papers/102/preview.pdf',
        size_bytes: 2048,
        reason: 'deleted_resource',
        attempts: 0,
        claimed_at: null,
        last_error: null,
      });

      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
