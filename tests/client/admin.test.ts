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

  it('preserves the collected origin, subject role and resource kind when creating a draft', async () => {
    const candidate = {
      id: 19, sourceKey: 'jhcee', externalKey: 'physics-answer', title: '2025 年四川高考物理答案',
      year: 2025, scope: 'regional', originType: 'provincial', series: '四川卷', subject: '物理',
      subjectRole: 'first_choice', regions: ['四川'], format: 'PDF', resourceKind: 'answer',
      resourceLinkType: 'drive',
      resourceUrl: 'https://example.com/answer.pdf', sourceUrl: 'https://example.com/source',
      classification: 'ordinary', reviewStatus: 'pending', paperId: null, possiblePaperIds: [],
    };
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      if (options?.method === 'POST') return json({ candidate: { ...candidate, reviewStatus: 'approved', paperId: 51 } });
      return json({ items: [candidate], page: 1, pageSize: 20, total: 1 });
    }));
    const page = await mountAt('/admin/candidates', AdminCandidatesPage);
    await flushPromises();
    expect(page.text()).toContain('网盘分享');

    await page.find('.candidate-actions > button').trigger('click');
    await flushPromises();

    const payload = JSON.parse(String(requests.find((request) => request.options?.method === 'POST')?.options?.body));
    expect(payload.paper).toMatchObject({
      originType: 'provincial', subjectRole: 'first_choice',
      resources: [expect.objectContaining({ kind: 'answer', linkType: 'drive' })],
    });
  });

  it('does not misclassify a manual candidate with an unknown origin as a regional paper', async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('crypto', { randomUUID: () => 'manual-candidate-id' });
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      if (options?.method === 'POST') return json({ id: 20, reviewStatus: 'pending' }, 201);
      return json({ items: [], page: 1, pageSize: 20, total: 0 });
    }));
    const page = await mountAt('/admin/candidates', AdminCandidatesPage);
    await flushPromises();
    await page.get('.admin-heading > button').trigger('click');
    const required = page.findAll('.manual-form input[required]');
    await required[0]!.setValue('命题范围待核试卷');
    await required[1]!.setValue('https://example.com/source');
    await page.get('.manual-form').trigger('submit');
    await flushPromises();

    const payload = JSON.parse(String(requests.find((request) => request.options?.method === 'POST')?.options?.body));
    expect(payload).toMatchObject({ originType: 'unknown', scope: null });
  });
});

describe('paper editing', () => {
  it('submits an unambiguous taxonomy, checked regions and an external question paper', async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      return json({ id: 42, title: '2024 年北京普通高考语文试卷', status: 'draft' });
    }));
    const page = await mountAt('/admin/papers/new', AdminPaperEditorPage);

    await page.find('input[name="title"]').setValue('2024 年北京普通高考语文试卷');
    await page.find('input[name="year"]').setValue('2024');
    expect(page.find('select[name="scope"]').exists()).toBe(false);
    await page.find('select[name="originType"]').setValue('provincial');
    await page.find('select[name="subjectRole"]').setValue('unified');
    await page.find('input[name="series"]').setValue('北京卷');
    await page.find('input[name="subject"]').setValue('语文');
    expect(page.findAll('input[name="regions"]')).toHaveLength(31);
    await page.find('input[name="regions"][value="北京"]').setValue(true);
    await page.find('input[name="resource-url-0"]').setValue('https://example.com/paper.pdf');
    await page.find('input[name="source-name-0"]').setValue('公开来源');
    await page.find('form').trigger('submit');
    await flushPromises();

    const save = requests.find((request) => request.options?.method === 'POST');
    expect(save?.url).toBe('/admin/api/papers');
    expect(JSON.parse(String(save?.options?.body))).toEqual({
      title: '2024 年北京普通高考语文试卷', year: 2024, scope: 'regional', series: '北京卷',
      originType: 'provincial', subject: '语文', subjectRole: 'unified', regions: ['北京'],
      resources: [{ format: 'PDF', kind: 'question', url: 'https://example.com/paper.pdf', linkType: 'source', sourceName: '公开来源' }],
    });
    expect(page.text()).toContain('保存成功');
  });

  it('offers the 2025/2026 national-paper presets only for unified subjects and applies all 11 regions for paper one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 42, title: '草稿', status: 'draft' })));
    const page = await mountAt('/admin/papers/new', AdminPaperEditorPage);

    await page.find('input[name="year"]').setValue('2025');
    await page.find('select[name="originType"]').setValue('national');
    await page.find('select[name="subjectRole"]').setValue('unified');
    await page.find('input[name="series"]').setValue('全国一卷');

    expect(page.text()).toContain('仅适用于语文、数学、外语等统一高考主科');
    await page.get('button[aria-label="应用 2025 年全国一卷地区预设"]').trigger('click');
    const selectedRegions = () => page.findAll('input[name="regions"]')
      .filter((input) => (input.element as HTMLInputElement).checked)
      .map((input) => input.attributes('value'));
    expect(selectedRegions()).toEqual(['河北', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东']);

    await page.find('select[name="subjectRole"]').setValue('first_choice');
    expect(page.find('button[aria-label="应用 2025 年全国一卷地区预设"]').exists()).toBe(false);
    expect(selectedRegions()).toEqual([]);

    await page.find('select[name="subjectRole"]').setValue('unified');
    await page.get('button[aria-label="应用 2025 年全国一卷地区预设"]').trigger('click');
    await page.find('input[name="year"]').setValue('2024');
    expect(selectedRegions()).toEqual([]);

    await page.find('input[name="year"]').setValue('2025');
    await page.get('button[aria-label="应用 2025 年全国一卷地区预设"]').trigger('click');
    await page.find('input[name="series"]').setValue('全国二卷');
    expect(selectedRegions()).toEqual([]);

    await page.find('input[name="series"]').setValue('全国一卷');
    await page.get('button[aria-label="应用 2025 年全国一卷地区预设"]').trigger('click');
    await page.find('select[name="originType"]').setValue('provincial');
    expect(selectedRegions()).toEqual([]);

    await page.find('select[name="originType"]').setValue('national');
    await page.find('input[name="year"]').setValue('2026');
    await page.find('input[name="series"]').setValue('全国二卷');
    await page.find('select[name="subjectRole"]').setValue('integrated');
    expect(page.text()).toContain('仅适用于文科综合、理科综合');
    await page.get('button[aria-label="应用 2026 年全国二卷地区预设"]').trigger('click');
    expect(selectedRegions()).toEqual(['西藏', '新疆']);

    await page.find('select[name="subjectRole"]').setValue('unified');
    await page.find('select[name="originType"]').setValue('provincial');
    expect(page.find('button[aria-label="应用 2026 年全国二卷地区预设"]').exists()).toBe(false);
  });

  it('clears a saved national-region preset when its taxonomy is changed during editing', async () => {
    const regions = ['浙江', '江苏', '山东', '广东', '河北', '福建', '湖北', '湖南', '河南', '江西', '安徽'];
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const paper = {
      id: 42, title: '2025 年全国一卷数学', year: 2025, scope: 'national',
      originType: 'national', series: '全国一卷', subject: '数学', subjectRole: 'unified',
      regions, status: 'draft', resources: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      return json(options?.method === 'PUT' ? { ...paper, ...JSON.parse(String(options.body)) } : paper);
    }));
    const page = await mountAt('/admin/papers/42', AdminPaperEditorPage);
    await flushPromises();
    const selectedRegions = () => page.findAll('input[name="regions"]')
      .filter((input) => (input.element as HTMLInputElement).checked)
      .map((input) => input.attributes('value'));
    expect(selectedRegions()).toHaveLength(11);

    await page.find('select[name="subjectRole"]').setValue('first_choice');
    expect(selectedRegions()).toEqual([]);
    expect(page.text()).toContain('原地区预设已清除');
    await page.find('form').trigger('submit');
    await flushPromises();

    const saved = requests.find((request) => request.options?.method === 'PUT');
    expect(JSON.parse(String(saved?.options?.body))).toMatchObject({ subjectRole: 'first_choice', regions: [] });
  });

  it('uploads, previews and deletes a PDF only after the draft has been saved', async () => {
    const uploaded = {
      id: 9, format: 'PDF', kind: 'question', linkType: 'upload',
      url: '/admin/api/resources/9/file', downloadUrl: '/admin/api/resources/9/file?download=1',
      fileName: '2025-全国一卷-数学.pdf', mimeType: 'application/pdf', sizeBytes: 1200,
    };
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      if (options?.method === 'POST') return json(uploaded, 201);
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({
        id: 42, title: '2025 全国一卷数学', year: 2025, scope: 'national', originType: 'national',
        series: '全国一卷', subject: '数学', subjectRole: 'unified', regions: ['河北'], status: 'draft', resources: [],
      });
    }));
    const page = await mountAt('/admin/papers/42', AdminPaperEditorPage);
    await flushPromises();
    const file = new File(['%PDF-1.7 sample'], uploaded.fileName, { type: 'application/pdf' });
    const fileInput = page.get('input[name="file-upload"]');
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [file] });
    await fileInput.trigger('change');
    await flushPromises();

    const upload = requests.find((request) => request.options?.method === 'POST');
    expect(upload?.options?.body).toBe(file);
    expect(page.text()).toContain(uploaded.fileName);
    expect(page.get('a[aria-label="在线查看 2025-全国一卷-数学.pdf"]').attributes('href')).toBe(uploaded.url);
    await page.get('button[aria-label="删除上传文件 2025-全国一卷-数学.pdf"]').trigger('click');
    await flushPromises();
    expect(requests.some((request) => request.url === '/admin/api/papers/42/resources/9' && request.options?.method === 'DELETE')).toBe(true);
    expect(page.text()).not.toContain(uploaded.fileName);
  });

  it('switches the stored-file picker to MP3 for listening audio and labels playback clearly', async () => {
    const uploaded = {
      id: 11, format: 'MP3', kind: 'listening_audio', linkType: 'upload',
      url: '/admin/api/resources/11/file', downloadUrl: '/admin/api/resources/11/file?download=1',
      fileName: '2025-英语听力.mp3', mimeType: 'audio/mpeg', sizeBytes: 4096,
    };
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ url: input, options });
      if (options?.method === 'POST') return json(uploaded, 201);
      return json({
        id: 42, title: '2025 全国一卷英语', year: 2025, scope: 'national', originType: 'national',
        series: '全国一卷', subject: '英语', subjectRole: 'unified', regions: ['河北'], status: 'draft', resources: [],
      });
    }));
    const page = await mountAt('/admin/papers/42', AdminPaperEditorPage);
    await flushPromises();
    await page.get('.upload-panel select[name="upload-kind"]').setValue('listening_audio');

    const fileInput = page.get('input[name="file-upload"]');
    expect(fileInput.attributes('accept')).toBe('audio/mpeg,.mp3');
    expect(page.text()).toContain('选择 MP3 上传');
    const file = new File(['ID3 audio'], uploaded.fileName, { type: 'audio/mpeg' });
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [file] });
    await fileInput.trigger('change');
    await flushPromises();

    const upload = requests.find((request) => request.options?.method === 'POST');
    expect(upload?.url).toContain('/admin/api/papers/42/resources/file?');
    expect(new Headers(upload?.options?.headers).get('content-type')).toBe('audio/mpeg');
    expect(page.text()).toContain('MP3 已上传，可在线播放');
    expect(page.get('a[aria-label="在线播放 2025-英语听力.mp3"]').attributes('href')).toBe(uploaded.url);
  });

  it('keeps publication disabled until an in-flight PDF upload has finished', async () => {
    let finishUpload!: (response: Response) => void;
    const pendingUpload = new Promise<Response>((resolve) => { finishUpload = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method === 'POST') return pendingUpload;
      return json({
        id: 42, title: '上传中的草稿', year: 2026, scope: 'national', originType: 'national',
        series: '全国一卷', subject: '数学', subjectRole: 'unified', regions: ['浙江'], status: 'draft', resources: [],
      });
    }));
    const page = await mountAt('/admin/papers/42', AdminPaperEditorPage);
    await flushPromises();
    const fileInput = page.get('input[name="file-upload"]');
    Object.defineProperty(fileInput.element, 'files', {
      configurable: true,
      value: [new File(['%PDF-1.7 sample'], 'uploading.pdf', { type: 'application/pdf' })],
    });
    await fileInput.trigger('change');
    await flushPromises();

    const publication = page.findAll('button').find((button) => button.text() === '确认并发布')!;
    expect(publication.attributes('disabled')).toBeDefined();

    finishUpload(json({
      id: 10, format: 'PDF', kind: 'question', linkType: 'upload',
      url: '/admin/api/resources/10/file', downloadUrl: '/admin/api/resources/10/file?download=1',
      fileName: 'uploading.pdf', mimeType: 'application/pdf', sizeBytes: 15,
    }, 201));
    await flushPromises();
    expect(publication.attributes('disabled')).toBeUndefined();
  });

  it('requires a published paper to be taken down before replacing uploaded files', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      id: 42, title: '已发布试卷', year: 2025, scope: 'national', originType: 'national', series: '全国一卷',
      subject: '数学', subjectRole: 'unified', regions: ['河北'], status: 'published', resources: [],
    })));
    const page = await mountAt('/admin/papers/42', AdminPaperEditorPage);
    await flushPromises();

    expect(page.text()).toContain('请先下架试卷，再上传或删除本站文件');
    expect(page.find('input[name="file-upload"]').exists()).toBe(false);
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
