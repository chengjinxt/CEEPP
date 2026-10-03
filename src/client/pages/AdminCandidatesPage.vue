<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { addCandidate, listCandidates, reviewCandidate } from '../api';
import type { Candidate, Page, PaperInput } from '../api';
import { safeHttpUrl } from '../urls';

const result = ref<Page<Candidate> | null>(null);
const page = ref(1);
const loading = ref(false);
const busyId = ref<number | null>(null);
const error = ref('');
const notice = ref('');
const mergeIds = reactive<Record<number, string>>({});
const showManual = ref(false);
const manual = reactive({ title: '', sourceUrl: '', year: '', scope: 'national' as 'national' | 'regional', series: '', subject: '', regions: '', format: 'PDF', resourceUrl: '' });

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try { result.value = await listCandidates(page.value); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取候选失败'; }
  finally { loading.value = false; }
}

function removeReviewed(id: number): void {
  if (!result.value) return;
  result.value.items = result.value.items.filter((item) => item.id !== id);
  result.value.total = Math.max(0, result.value.total - 1);
}

async function merge(candidate: Candidate): Promise<void> {
  const paperId = Number(mergeIds[candidate.id]);
  if (!Number.isSafeInteger(paperId) || paperId < 1) { error.value = '请输入有效的目标试卷 ID'; return; }
  busyId.value = candidate.id;
  error.value = '';
  try {
    await reviewCandidate(candidate.id, { action: 'merge', paperId });
    removeReviewed(candidate.id);
    notice.value = '候选资料已合并到试卷';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '合并失败'; }
  finally { busyId.value = null; }
}

function candidatePaper(candidate: Candidate): PaperInput | null {
  const resourceUrl = safeHttpUrl(candidate.resourceUrl);
  const sourceUrl = safeHttpUrl(candidate.sourceUrl);
  if (!candidate.year || !candidate.scope || !candidate.series || !candidate.subject || !resourceUrl || !sourceUrl) return null;
  return {
    title: candidate.title, year: candidate.year, scope: candidate.scope, series: candidate.series,
    subject: candidate.subject, regions: candidate.regions,
    resources: [{ format: candidate.format || 'PDF', url: resourceUrl, linkType: 'source', sourceName: candidate.sourceKey, sourceUrl }],
  };
}

async function create(candidate: Candidate): Promise<void> {
  const paper = candidatePaper(candidate);
  if (!paper) { error.value = '候选信息不完整，请先手动建立试卷，再将候选合并进去'; return; }
  busyId.value = candidate.id;
  error.value = '';
  try {
    await reviewCandidate(candidate.id, { action: 'create', paper });
    removeReviewed(candidate.id);
    notice.value = '已由候选创建草稿，请在试卷管理中检查后发布';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建草稿失败'; }
  finally { busyId.value = null; }
}

async function reject(candidate: Candidate): Promise<void> {
  busyId.value = candidate.id;
  error.value = '';
  try {
    await reviewCandidate(candidate.id, { action: 'reject' });
    removeReviewed(candidate.id);
    notice.value = '候选资料已驳回';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '驳回失败'; }
  finally { busyId.value = null; }
}

async function addManual(): Promise<void> {
  error.value = '';
  try {
    await addCandidate({
      sourceKey: 'manual', externalKey: crypto.randomUUID(), title: manual.title.trim(), sourceUrl: manual.sourceUrl.trim(),
      year: manual.year ? Number(manual.year) : null, scope: manual.scope, series: manual.series.trim() || null,
      subject: manual.subject.trim() || null, regions: manual.regions.split(/[、,，]/).map((part) => part.trim()).filter(Boolean),
      format: manual.format.trim() || null, resourceUrl: manual.resourceUrl.trim() || null, classification: 'uncertain',
    });
    showManual.value = false;
    manual.title = ''; manual.sourceUrl = ''; manual.year = ''; manual.series = ''; manual.subject = ''; manual.regions = ''; manual.resourceUrl = '';
    notice.value = '手动候选已加入待审核队列';
    page.value = 1;
    await load();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '补录失败'; }
}

function turn(next: number): void { page.value = next; void load(); }

onMounted(() => void load());
</script>

<template>
  <main class="container admin-page">
    <div class="admin-heading"><div><p class="eyebrow">ADMIN / REVIEW</p><h1>采集候选</h1><p>核对来源、分类与链接后，再建立草稿或合并到已有试卷。</p></div><button class="button button-secondary" type="button" @click="showManual = !showManual">{{ showManual ? '收起补录' : '+ 手动补录候选' }}</button></div>
    <nav class="admin-tabs" aria-label="管理导航"><RouterLink to="/admin/candidates" active-class="active">候选审核</RouterLink><RouterLink to="/admin/papers" active-class="active">试卷管理</RouterLink><RouterLink to="/admin/papers/new">新增试卷</RouterLink></nav>

    <form v-if="showManual" class="admin-panel manual-form" @submit.prevent="addManual">
      <div class="section-heading"><div><h2>手动补录候选</h2></div><p>补录后仍需审核</p></div>
      <div class="form-grid"><label class="wide">候选名称<input v-model="manual.title" required></label><label class="wide">来源页面 URL<input v-model="manual.sourceUrl" type="url" required></label><label>年份<input v-model="manual.year" type="number" min="1977"></label><label>卷别<select v-model="manual.scope"><option value="national">全国卷</option><option value="regional">地区卷</option></select></label><label>试卷系列<input v-model="manual.series"></label><label>科目<input v-model="manual.subject"></label><label>适用地区<input v-model="manual.regions" placeholder="多个地区用逗号分隔"></label><label>格式<input v-model="manual.format"></label><label class="wide">资源 URL<input v-model="manual.resourceUrl" type="url"></label></div>
      <button class="button button-primary" type="submit">加入待审核</button>
    </form>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
    <div v-if="loading && !result" class="state-panel">正在读取候选…</div>
    <div v-else-if="result && result.items.length === 0" class="state-panel"><h2>暂无待审核资料</h2><p>新采集结果和手动补录会出现在这里。</p></div>
    <div v-else-if="result" class="candidate-list">
      <article v-for="candidate in result.items" :key="candidate.id" class="admin-panel candidate-card">
        <div class="candidate-top"><span class="pill" :class="candidate.classification === 'uncertain' ? 'pill-warning' : ''">{{ candidate.classification === 'ordinary' ? '普通高考候选' : '分类待核' }}</span><span class="muted">{{ candidate.sourceKey }} · #{{ candidate.id }}</span></div>
        <h2>{{ candidate.title }}</h2>
        <p class="candidate-meta">{{ candidate.year || '年份待核' }} · {{ candidate.series || '卷别待核' }} · {{ candidate.subject || '科目待核' }} · {{ candidate.regions.join('、') || '地区待核' }}</p>
        <div class="candidate-links"><a v-if="safeHttpUrl(candidate.sourceUrl)" :href="safeHttpUrl(candidate.sourceUrl)!" target="_blank" rel="noopener noreferrer">查看来源 ↗</a><a v-if="safeHttpUrl(candidate.resourceUrl)" :href="safeHttpUrl(candidate.resourceUrl)!" target="_blank" rel="noopener noreferrer">检查资源 ↗</a></div>
        <div v-if="candidate.possiblePaperIds?.length" class="duplicate-suggestions"><span>可能重复：</span><button v-for="id in candidate.possiblePaperIds" :key="id" type="button" :aria-label="`选择疑似重复试卷 ${id}`" @click="mergeIds[candidate.id] = String(id)">试卷 #{{ id }}</button><small>请先核对再合并</small></div>
        <div class="candidate-actions"><button class="button button-primary" type="button" :disabled="busyId === candidate.id || !candidatePaper(candidate)" @click="create(candidate)">创建草稿</button><div class="merge-control"><input v-model="mergeIds[candidate.id]" type="number" min="1" aria-label="目标试卷 ID" placeholder="目标试卷 ID"><button class="button button-secondary" type="button" :aria-label="`合并候选 ${candidate.id}`" :disabled="busyId === candidate.id" @click="merge(candidate)">合并</button></div><button class="button button-text danger" type="button" :disabled="busyId === candidate.id" @click="reject(candidate)">驳回</button></div>
        <p class="candidate-merge-warning">合并至已发布试卷后，资源会立即公开。</p>
      </article>
    </div>
    <nav v-if="result && result.total > result.pageSize" class="pagination" aria-label="候选分页"><button type="button" :disabled="loading || page <= 1" @click="turn(page - 1)">← 上一页</button><span>第 {{ page }} 页</span><button type="button" :disabled="loading || page >= Math.ceil(result.total / result.pageSize)" @click="turn(page + 1)">下一页 →</button></nav>
  </main>
</template>
