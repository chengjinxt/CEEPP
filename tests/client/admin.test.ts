// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import AdminCandidatesPage from '../../src/client/pages/AdminCandidatesPage.vue';
import AdminPaperEditorPage from '../../src/client/pages/AdminPaperEditorPage.vue';
import AdminPapersPage from '../../src/client/pages/AdminPapersPage.vue';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function mountAt(path: string, component: typeof AdminCandidatesPage | typeof AdminPaperEditorPage | typeof AdminPapersPage) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/candidates', component: AdminCandidatesPage },
      { path: '/admin/papers', component: AdminPapersPage },
      { path: '/admin/papers/new', component: AdminPaperEditorPage },
      { path: '/admin/papers/:id', component: AdminPaperEditorPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  return mount(component, { global: { plugins: [router] } });
}

afterEach(() => vi.unstubAllGlobals());

describe('candidate review', () => {
  it('merges a candidate into an existing paper and removes it from the pending list', async () => {
    const candidate = {
      id: 7, sourceKey: 'gaokaomath', externalKey: '2024-math', title: '2024 年全国卷数学',
      year: 2024, scope: 'national', series: '新高考 I 卷', subject: '数学', regions: ['山东'],
      format: 'PDF', resourceUrl: 'https://example.com/paper.pdf', sourceUrl: 'https://example.com',
      classification: 'ordinary', reviewStatus: 'pending', paperId: null, possiblePaperIds: [42],
    };
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      if (options?.method === 'POST') return json({ candidate: { ...candidate, reviewStatus: 'approved', paperId: 42 } });
      return json({ items: [candidate], page: 1, pageSize: 20, total: 1 });
    }));

    const page = await mountAt('/admin/candidates', AdminCandidatesPage);
    await flushPromises();
    expect(page.text()).toContain('合并至已发布试卷后，资源会立即公开');
    await page.find('input[aria-label="目标试卷 ID"]').setValue('42');
    await page.find('button[aria-label="合并候选 7"]').trigger('click');
    await flushPromises();

    expect(requests.at(-1)?.url).toBe('/admin/api/candidates/7/review');
    expect(JSON.parse(String(requests.at(-1)?.options?.body))).toEqual({ action: 'merge', paperId: 42 });
    expect(page.text()).not.toContain(candidate.title);
  });

  it('explains when an administrator API rejects the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: '管理员身份验证失败' }, 403)));
    const page = await mountAt('/admin/candidates', AdminCandidatesPage);
    await flushPromises();
    expect(page.text()).toContain('管理员身份验证失败');
  });

  it('does not render unsafe collected URLs as clickable links', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      items: [{ id: 8, sourceKey: 'outside', externalKey: 'x', title: '待核资料', year: null, scope: null, series: null, subject: null, regions: [], format: null, resourceUrl: 'javascript:alert(1)', sourceUrl: 'data:text/html,evil', classification: 'uncertain', reviewStatus: 'pending', paperId: null, possiblePaperIds: [] }],
      page: 1, pageSize: 20, total: 1,
    })));
    const page = await mountAt('/admin/candidates', AdminCandidatesPage);
    await flushPromises();
    expect(page.findAll('.candidate-links a')).toHaveLength(0);
  });

  it('offers a possible duplicate paper as the merge target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      items: [{ id: 7, sourceKey: 'gaokaomath', externalKey: '2024-math', title: '2024 年全国卷数学', year: 2024, scope: 'national', series: '新高考 I 卷', subject: '数学', regions: ['山东'], format: 'PDF', resourceUrl: 'https://example.com/paper.pdf', sourceUrl: 'https://example.com', classification: 'ordinary', reviewStatus: 'pending', paperId: null, possiblePaperIds: [42] }],
      page: 1, pageSize: 20, total: 1,
    })));
    const page = await mountAt('/admin/candidates', AdminCandidatesPage);
    await flushPromises();
    await page.find('button[aria-label="选择疑似重复试卷 42"]').trigger('click');

    expect((page.get('input[aria-label="目标试卷 ID"]').element as HTMLInputElement).value).toBe('42');
  });
});

describe('paper editing', () => {
  it('submits a paper with regions and an external resource', async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      return json({ id: 42, title: '2024 年北京普通高考语文试卷', status: 'draft' });
    }));
    const page = await mountAt('/admin/papers/new', AdminPaperEditorPage);

    await page.find('input[name="title"]').setValue('2024 年北京普通高考语文试卷');
    await page.find('input[name="year"]').setValue('2024');
    await page.find('select[name="scope"]').setValue('regional');
    await page.find('input[name="series"]').setValue('北京卷');
    await page.find('input[name="subject"]').setValue('语文');
    await page.find('input[name="regions"]').setValue('北京');
    await page.find('input[name="resource-url-0"]').setValue('https://example.com/paper.pdf');
    await page.find('input[name="source-name-0"]').setValue('公开来源');
    await page.find('form').trigger('submit');
    await flushPromises();

    const save = requests.find((request) => request.options?.method === 'POST');
    expect(save?.url).toBe('/admin/api/papers');
    expect(JSON.parse(String(save?.options?.body))).toEqual({
      title: '2024 年北京普通高考语文试卷', year: 2024, scope: 'regional', series: '北京卷',
      subject: '语文', regions: ['北京'],
      resources: [{ format: 'PDF', url: 'https://example.com/paper.pdf', linkType: 'source', sourceName: '公开来源' }],
    });
    expect(page.text()).toContain('保存成功');
  });

  it('publishes a draft through the status endpoint', async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      if (options?.method === 'POST') return json({ id: 42, title: '2024 年北京普通高考语文试卷', status: 'published' });
      return json({
        items: [{ id: 42, title: '2024 年北京普通高考语文试卷', year: 2024, scope: 'regional', series: '北京卷', subject: '语文', regions: ['北京'], status: 'draft' }],
        page: 1, pageSize: 20, total: 1,
      });
    }));
    const page = await mountAt('/admin/papers', AdminPapersPage);
    await flushPromises();
    await page.find('button[aria-label="发布试卷 42"]').trigger('click');
    await flushPromises();

    const statusRequest = requests.find((request) => request.options?.method === 'POST');
    expect(statusRequest?.url).toBe('/admin/api/papers/42/status');
    expect(JSON.parse(String(statusRequest?.options?.body))).toEqual({ status: 'published' });
    expect(page.text()).toContain('已发布');
    expect(page.findAll('.admin-paper-row')).toHaveLength(0);
  });

  it('reloads the editor when SPA navigation changes the paper ID', async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      const id = input.endsWith('/2') ? 2 : 1;
      return json({ id, title: id === 1 ? '第一份试卷' : '第二份试卷', year: 2024, scope: 'regional', series: '北京卷', subject: '语文', regions: ['北京'], status: 'draft', resources: [] });
    }));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/papers/:id', component: AdminPaperEditorPage }] });
    await router.push('/admin/papers/1');
    await router.isReady();
    const editor = mount(AdminPaperEditorPage, { global: { plugins: [router] } });
    await flushPromises();
    expect((editor.get('input[name="title"]').element as HTMLInputElement).value).toBe('第一份试卷');

    await router.push('/admin/papers/2');
    await flushPromises();
    expect((editor.get('input[name="title"]').element as HTMLInputElement).value).toBe('第二份试卷');
    await editor.find('form').trigger('submit');
    await flushPromises();
    expect(requests.at(-1)?.url).toBe('/admin/api/papers/2');
  });
});
