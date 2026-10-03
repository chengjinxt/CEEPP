// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPapers } from '../../src/client/api';

afterEach(() => vi.unstubAllGlobals());

describe('public paper search', () => {
  it('sends every selected filter and the page to the catalog API', async () => {
    const fetcher = vi.fn(async (_input: string) => new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, total: 0 }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    const result = await listPapers({ year: '2024', scope: 'regional', region: '北京', subject: '语文', q: '真题', page: 2 });

    const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]), 'https://example.test');
    expect(requestUrl.pathname).toBe('/api/papers');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      year: '2024', scope: 'regional', region: '北京', subject: '语文', q: '真题', page: '2',
    });
    expect(result).toEqual({ items: [], page: 2, pageSize: 20, total: 0 });
  });

  it('surfaces an API failure instead of treating it as an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '数据库暂不可用' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(listPapers({ page: 1 })).rejects.toThrow('数据库暂不可用');
  });
});
