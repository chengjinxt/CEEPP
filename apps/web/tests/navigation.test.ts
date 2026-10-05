// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import App from '../src/App.vue';
import { createAppRouter } from '../src/router';

afterEach(() => vi.unstubAllGlobals());

describe('site navigation', () => {
  it('opens the ordinary-gaokao guide from a direct link', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/guide/scope');
    await router.isReady();
    const app = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(app.get('h1').text()).toContain('普通高考');
    expect(app.text()).toContain('春季高考');
  });

  it('explains that paper origin and subject-selection roles are different dimensions', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/guide/terms');
    await router.isReady();
    const app = mount(App, { global: { plugins: [router] } });

    expect(app.text()).toContain('命题方式不等于选科方式');
    expect(app.text()).toContain('统一高考科目');
    expect(app.text()).toContain('首选科目');
    expect(app.text()).toContain('再选科目');
    expect(app.text()).toContain('全国卷与适用地区的对应关系会随年份和科目变化');
    expect(app.text()).toContain('文科综合、理科综合不是新高考选考科目');
  });

  it('routes the admin landing page to the review queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), {
      headers: { 'content-type': 'application/json' },
    })));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/admin/candidates');
  });

  it.each([
    ['header', '.header-admin'],
    ['footer', '.footer-links a[href="/admin"]'],
  ])('lets the browser navigate to the protected admin page from the %s link', async (_location, selector) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), {
      headers: { 'content-type': 'application/json' },
    })));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/');
    await router.isReady();
    const app = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    const link = app.get(selector);
    expect(link.attributes('href')).toBe('/admin');
    let intercepted = true;
    link.element.addEventListener('click', (event) => {
      intercepted = event.defaultPrevented;
      event.preventDefault(); // Avoid jsdom's unsupported full-page navigation.
    }, { once: true });
    link.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(intercepted).toBe(false);
    expect(router.currentRoute.value.path).toBe('/');
  });
});
