// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomePage from '../../src/client/pages/HomePage.vue';
import PaperPage from '../../src/client/pages/PaperPage.vue';

const samplePaper = {
  id: 42,
  title: '2024 年北京普通高考语文试卷',
  year: 2024,
  scope: 'regional',
  series: '北京卷',
  subject: '语文',
  regions: ['北京'],
  status: 'published',
};

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

async function mountAt(path: string, component: typeof HomePage | typeof PaperPage) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomePage },
      { path: '/papers/:id', component: PaperPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  return mount(component, { global: { plugins: [router] } });
}

afterEach(() => vi.unstubAllGlobals());

describe('paper catalog', () => {
  it('uses selected filters and shows matching results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const params = new URL(input, 'https://example.test').searchParams;
      return json(params.get('year') === '2024' && params.get('subject') === '语文'
        ? { items: [samplePaper], page: 1, pageSize: 20, total: 1 }
        : { items: [], page: 1, pageSize: 20, total: 0 });
    }));
    const page = await mountAt('/', HomePage);
    await flushPromises();

    await page.find('select[name="year"]').setValue('2024');
    await page.find('input[name="subject"]').setValue('语文');
    await page.find('form[aria-label="查找试卷"]').trigger('submit');
    await flushPromises();

    expect(page.text()).toContain(samplePaper.title);
    expect(page.find('a[href="/papers/42"]').exists()).toBe(true);
  });

  it('distinguishes no matching papers from a loading or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], page: 1, pageSize: 20, total: 0 })));
    const page = await mountAt('/', HomePage);
    await flushPromises();
    expect(page.text()).toContain('没有找到符合条件的试卷');
  });

  it('loads the next results page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const page = new URL(input, 'https://example.test').searchParams.get('page');
      return json({ items: [{ ...samplePaper, id: page === '2' ? 43 : 42, title: page === '2' ? '第二页试卷' : samplePaper.title }], page: Number(page), pageSize: 20, total: 21 });
    }));
    const page = await mountAt('/', HomePage);
    await flushPromises();
    await page.find('button[aria-label="下一页"]').trigger('click');
    await flushPromises();

    expect(page.text()).toContain('第二页试卷');
    expect(page.text()).toContain('第 2 页');
  });

  it('can search a historical year before 1977', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const year = new URL(input, 'https://example.test').searchParams.get('year');
      return json({ items: year === '1952' ? [{ ...samplePaper, id: 52, title: '1952 年普通高考试卷', year: 1952 }] : [], page: 1, pageSize: 20, total: year === '1952' ? 1 : 0 });
    }));
    const page = await mountAt('/', HomePage);
    await flushPromises();
    await page.find('select[name="year"]').setValue('1952');
    await page.find('form[aria-label="查找试卷"]').trigger('submit');
    await flushPromises();
    expect(page.text()).toContain('1952 年普通高考试卷');
  });
});

describe('paper detail', () => {
  it('shows every verified download format with safe external links', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    vi.stubGlobal('fetch', vi.fn(async () => json({
      ...samplePaper,
      resources: [
        { id: 1, format: 'PDF', url: 'https://example.com/paper.pdf', linkType: 'source', sourceName: '公开来源', sourceUrl: 'https://example.com', accessCode: null, verifiedAt: '2026-10-01' },
        { id: 2, format: 'HTML', url: 'https://drive.example.com/abc', linkType: 'drive', sourceName: '本站网盘', sourceUrl: null, accessCode: '1234', verifiedAt: '2026-10-01' },
      ],
    })));
    const page = await mountAt('/papers/42', PaperPage);
    await flushPromises();

    expect(page.text()).toContain(samplePaper.title);
    expect(page.text()).toContain('PDF');
    expect(page.text()).toContain('HTML');
    expect(page.text()).toContain('1234');
    const links = page.findAll('a[target="_blank"]');
    expect(links.map((link) => link.attributes('href'))).toContain('https://example.com/paper.pdf');
    expect(links.map((link) => link.attributes('href'))).toContain('https://drive.example.com/abc');
    expect(links.map((link) => link.attributes('href'))).toContain('https://example.com/');
    expect(links.every((link) => link.attributes('rel')?.includes('noopener'))).toBe(true);
  });
});
