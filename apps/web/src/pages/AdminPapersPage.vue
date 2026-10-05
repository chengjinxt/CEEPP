<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { deletePaper, listAdminPapers, setPaperStatus } from '../api';
import type { Page, PaperStatus, PaperSummary } from '../api';

const status = ref<PaperStatus>('draft');
const page = ref(1);
const result = ref<Page<PaperSummary> | null>(null);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const busyId = ref<number | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try { result.value = await listAdminPapers(status.value, page.value); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取试卷失败'; }
  finally { loading.value = false; }
}

function selectStatus(next: PaperStatus): void { status.value = next; page.value = 1; result.value = null; void load(); }
function turn(next: number): void { page.value = next; void load(); }

async function changeStatus(paper: PaperSummary): Promise<void> {
  busyId.value = paper.id;
  error.value = '';
  const next: PaperStatus = paper.status === 'draft' ? 'published' : 'draft';
  try {
    await setPaperStatus(paper.id, next);
    if (result.value) {
      result.value.items = result.value.items.filter((item) => item.id !== paper.id);
      result.value.total = Math.max(0, result.value.total - 1);
    }
    notice.value = next === 'published' ? '试卷已发布' : '试卷已下架';
    if (result.value && !result.value.items.length && page.value > 1) { page.value -= 1; await load(); }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新状态失败'; }
  finally { busyId.value = null; }
}

async function removeDraft(paper: PaperSummary): Promise<void> {
  if (paper.status !== 'draft' || !window.confirm(`确定删除草稿“${paper.title}”吗？此操作不可撤销。`)) return;
  busyId.value = paper.id;
  error.value = '';
  try {
    await deletePaper(paper.id);
    if (result.value) {
      result.value.items = result.value.items.filter((item) => item.id !== paper.id);
      result.value.total = Math.max(0, result.value.total - 1);
    }
    notice.value = '草稿已删除';
    if (result.value && !result.value.items.length && page.value > 1) { page.value -= 1; await load(); }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除草稿失败'; }
  finally { busyId.value = null; }
}

onMounted(() => void load());
</script>

<template>
  <main class="container admin-page">
    <div class="admin-heading"><div><p class="eyebrow">ADMIN / PAPERS</p><h1>试卷管理</h1><p>编辑资料、核对资源链接，再决定是否公开。</p></div><RouterLink class="button button-primary" to="/admin/papers/new">+ 新增试卷</RouterLink></div>
    <nav class="admin-tabs" aria-label="管理导航"><RouterLink to="/admin/candidates">候选审核</RouterLink><RouterLink to="/admin/papers" active-class="active">试卷管理</RouterLink></nav>
    <div class="status-switch"><button type="button" :class="{ active: status === 'draft' }" @click="selectStatus('draft')">草稿</button><button type="button" :class="{ active: status === 'published' }" @click="selectStatus('published')">已发布</button></div>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
    <div v-if="loading && !result" class="state-panel">正在读取试卷…</div>
    <div v-else-if="result && result.items.length === 0" class="state-panel"><h2>这个列表暂时为空</h2><p>可以新增试卷，或切换状态查看。</p></div>
    <div v-else-if="result" class="admin-paper-list">
      <article v-for="paper in result.items" :key="paper.id" class="admin-panel admin-paper-row">
        <div><span class="pill" :class="paper.status === 'published' ? 'pill-success' : ''">{{ paper.status === 'published' ? '已发布' : '草稿' }}</span><h2>{{ paper.title }}</h2><p>{{ paper.year }} · {{ paper.series }} · {{ paper.subject }} · {{ paper.regions.join('、') }}</p></div>
        <div class="row-actions"><RouterLink class="button button-secondary" :to="`/admin/papers/${paper.id}`">编辑</RouterLink><button v-if="paper.status === 'draft'" class="button button-text danger" type="button" :aria-label="`删除草稿 ${paper.id}`" :disabled="busyId === paper.id" @click="removeDraft(paper)">删除</button><button class="button button-primary" type="button" :aria-label="`${paper.status === 'draft' ? '发布' : '下架'}试卷 ${paper.id}`" :disabled="busyId === paper.id" @click="changeStatus(paper)">{{ paper.status === 'draft' ? '发布' : '下架' }}</button></div>
      </article>
    </div>
    <nav v-if="result && result.total > result.pageSize" class="pagination" aria-label="试卷分页"><button type="button" :disabled="loading || page <= 1" @click="turn(page - 1)">← 上一页</button><span>第 {{ page }} 页</span><button type="button" :disabled="loading || page >= Math.ceil(result.total / result.pageSize)" @click="turn(page + 1)">下一页 →</button></nav>
  </main>
</template>
