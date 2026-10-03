// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import App from '../../src/client/App.vue';
import { createAppRouter } from '../../src/client/router';

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

  it('routes the admin landing page to the review queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), {
      headers: { 'content-type': 'application/json' },
    })));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/admin/candidates');
    vi.unstubAllGlobals();
  });
});
