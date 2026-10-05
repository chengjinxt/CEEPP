import { createRouter, createWebHistory } from 'vue-router';
import type { RouterHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import PaperPage from './pages/PaperPage.vue';
import GuidePage from './pages/GuidePage.vue';
import AdminCandidatesPage from './pages/AdminCandidatesPage.vue';
import AdminPapersPage from './pages/AdminPapersPage.vue';
import AdminPaperEditorPage from './pages/AdminPaperEditorPage.vue';

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({ history, routes: [
    { path: '/', component: HomePage },
    { path: '/papers/:id', component: PaperPage },
    { path: '/guide/:slug', component: GuidePage },
    { path: '/admin', redirect: '/admin/candidates' },
    { path: '/admin/candidates', component: AdminCandidatesPage },
    { path: '/admin/papers', component: AdminPapersPage },
    { path: '/admin/papers/new', component: AdminPaperEditorPage },
    { path: '/admin/papers/:id', component: AdminPaperEditorPage },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ] });
}
