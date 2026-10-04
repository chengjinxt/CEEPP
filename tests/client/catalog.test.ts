// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPapers, uploadPaperFile } from '../../src/client/api';
import * as paperApi from '../../src/client/api';

afterEach(() => vi.unstubAllGlobals());

describe('public paper search', () => {
  it('sends every selected filter and the page to the catalog API', async () => {
    const fetcher = vi.fn(async (_input: string) => new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, total: 0 }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    const result = await listPapers({
      year: '2024', originType: 'provincial', subjectRole: 'unified',
      region: '北京', subject: '语文', q: '真题', page: 2,
    });

    const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]), 'https://example.test');
    expect(requestUrl.pathname).toBe('/api/papers');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      year: '2024', originType: 'provincial', subjectRole: 'unified',
      region: '北京', subject: '语文', q: '真题', page: '2',
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

  it('uploads a PDF as an unmodified binary body with its filename and resource kind', async () => {
    const file = new File(['%PDF-1.7 sample'], '2025 全国一卷 数学.pdf', { type: 'application/pdf' });
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({
      id: 9, format: 'PDF', kind: 'question', linkType: 'upload', url: '/admin/api/resources/9/file',
      downloadUrl: '/admin/api/resources/9/file?download=1', fileName: file.name, mimeType: 'application/pdf', sizeBytes: file.size,
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);

    await uploadPaperFile(42, file, 'question');

    const [requestUrl, requestInit] = fetcher.mock.calls[0]!;
    const parsed = new URL(String(requestUrl), 'https://example.test');
    expect(parsed.pathname).toBe('/admin/api/papers/42/resources/file');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ filename: file.name, kind: 'question' });
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.body).toBe(file);
    expect(new Headers(requestInit?.headers).get('content-type')).toBe('application/pdf');
    expect(new Headers(requestInit?.headers).get('x-ceepp-file-size')).toBe(String(file.size));
  });

  it('uploads listening audio as MP3 with the browser-independent MIME type', async () => {
    const file = new File(['ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000audio'], '2025 英语听力.mp3', { type: '' });
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({
      id: 10, format: 'MP3', kind: 'listening_audio', linkType: 'upload', url: '/admin/api/resources/10/file',
      downloadUrl: '/admin/api/resources/10/file?download=1', fileName: file.name, mimeType: 'audio/mpeg', sizeBytes: file.size,
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);

    await uploadPaperFile(42, file, 'listening_audio');

    const [requestUrl, requestInit] = fetcher.mock.calls[0]!;
    const parsed = new URL(String(requestUrl), 'https://example.test');
    expect(parsed.pathname).toBe('/admin/api/papers/42/resources/file');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ filename: file.name, kind: 'listening_audio' });
    expect(requestInit?.body).toBe(file);
    expect(new Headers(requestInit?.headers).get('content-type')).toBe('audio/mpeg');
  });

  it('deletes an uploaded resource from the selected paper', async () => {
    const deletePaperResource = (paperApi as unknown as {
      deletePaperResource?: (paperId: number, resourceId: number) => Promise<void>;
    }).deletePaperResource;
    expect(deletePaperResource).toBeTypeOf('function');
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);

    await deletePaperResource!(42, 9);

    expect(fetcher).toHaveBeenCalledWith('/admin/api/papers/42/resources/9', expect.objectContaining({ method: 'DELETE' }));
  });
});
