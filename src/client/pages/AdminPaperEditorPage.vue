<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { getAdminPaper, savePaper, setPaperStatus } from '../api';
import type { PaperInput, PaperStatus, ResourceInput, Scope } from '../api';

interface ResourceDraft { format: string; url: string; linkType: 'source' | 'drive'; sourceName: string; sourceUrl: string; accessCode: string; verifiedAt: string }
const route = useRoute();
const paperId = computed(() => route.params.id ? Number(route.params.id) : null);
const savedId = ref<number | null>(null);
const status = ref<PaperStatus>('draft');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const form = reactive({ title: '', year: '', scope: 'national' as Scope, series: '', subject: '', regions: '' });
const resources = ref<ResourceDraft[]>([newResource()]);
let loadNumber = 0;

function newResource(): ResourceDraft { return { format: 'PDF', url: '', linkType: 'source', sourceName: '', sourceUrl: '', accessCode: '', verifiedAt: '' }; }

async function load(): Promise<void> {
  const current = ++loadNumber;
  if (!paperId.value || !Number.isSafeInteger(paperId.value)) {
    savedId.value = null;
    status.value = 'draft';
    form.title = ''; form.year = ''; form.scope = 'national'; form.series = ''; form.subject = ''; form.regions = '';
    resources.value = [newResource()];
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const paper = await getAdminPaper(paperId.value);
    if (current !== loadNumber) return;
    savedId.value = paper.id;
    status.value = paper.status;
    form.title = paper.title; form.year = String(paper.year); form.scope = paper.scope; form.series = paper.series;
    form.subject = paper.subject; form.regions = paper.regions.join('、');
    resources.value = paper.resources.length ? paper.resources.map((resource) => ({
      format: resource.format, url: resource.url, linkType: resource.linkType,
      sourceName: resource.sourceName || '', sourceUrl: resource.sourceUrl || '',
      accessCode: resource.accessCode || '', verifiedAt: resource.verifiedAt?.slice(0, 10) || '',
    })) : [newResource()];
  } catch (cause) { if (current === loadNumber) error.value = cause instanceof Error ? cause.message : '读取试卷失败'; }
  finally { if (current === loadNumber) loading.value = false; }
}

function input(): PaperInput {
  const entries: ResourceInput[] = resources.value.filter((resource) => resource.url.trim()).map((resource) => ({
    format: resource.format.trim(), url: resource.url.trim(), linkType: resource.linkType,
    ...(resource.sourceName.trim() ? { sourceName: resource.sourceName.trim() } : {}),
    ...(resource.sourceUrl.trim() ? { sourceUrl: resource.sourceUrl.trim() } : {}),
    ...(resource.accessCode.trim() ? { accessCode: resource.accessCode.trim() } : {}),
    ...(resource.verifiedAt ? { verifiedAt: resource.verifiedAt } : {}),
  }));
  return {
    title: form.title.trim(), year: Number(form.year), scope: form.scope,
    series: form.series.trim(), subject: form.subject.trim(),
    regions: [...new Set(form.regions.split(/[、,，]/).map((part) => part.trim()).filter(Boolean))],
    resources: entries,
  };
}

async function save(): Promise<void> {
  notice.value = '';
  error.value = '';
  saving.value = true;
  try {
    const paper = await savePaper(input(), paperId.value || savedId.value || undefined);
    savedId.value = paper.id;
    status.value = paper.status;
    notice.value = '保存成功，试卷仍需确认后发布';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败'; }
  finally { saving.value = false; }
}

async function changeStatus(): Promise<void> {
  if (!savedId.value) return;
  notice.value = '';
  error.value = '';
  saving.value = true;
  const next: PaperStatus = status.value === 'draft' ? 'published' : 'draft';
  try {
    await setPaperStatus(savedId.value, next);
    status.value = next;
    notice.value = next === 'published' ? '试卷已发布' : '试卷已下架';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新状态失败'; }
  finally { saving.value = false; }
}

onMounted(() => void load());
watch(() => route.params.id, () => void load());
</script>

<template>
  <main class="container admin-page">
    <div class="admin-heading"><div><p class="eyebrow">ADMIN / EDITOR</p><h1>{{ paperId ? '编辑试卷' : '新增试卷' }}</h1><p>一份试卷可关联多个地区与多种格式资源。</p></div><RouterLink class="button button-secondary" to="/admin/papers">← 返回列表</RouterLink></div>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="state-panel">正在读取试卷…</div>
    <form v-else class="editor-layout" @submit.prevent="save">
      <section class="admin-panel editor-main">
        <div class="section-heading"><div><p class="eyebrow">BASIC INFORMATION</p><h2>基本信息</h2></div><span class="pill" :class="status === 'published' ? 'pill-success' : ''">{{ status === 'published' ? '已发布' : '草稿' }}</span></div>
        <div class="form-grid"><label class="wide">试卷名称<input v-model="form.title" name="title" required placeholder="例如：2024 年北京普通高考语文试卷"></label><label>年份<input v-model="form.year" name="year" type="number" min="1977" max="2100" required></label><label>卷别<select v-model="form.scope" name="scope"><option value="national">全国卷</option><option value="regional">地区卷</option></select></label><label>试卷系列<input v-model="form.series" name="series" required placeholder="例如：新高考 I 卷"></label><label>科目<input v-model="form.subject" name="subject" required placeholder="例如：数学"></label><label class="wide">适用地区<input v-model="form.regions" name="regions" placeholder="多个地区用逗号分隔"><small>同一试卷适用于多个地区时，只建一条记录。</small></label></div>
      </section>
      <section class="admin-panel editor-main">
        <div class="section-heading"><div><p class="eyebrow">RESOURCES</p><h2>资源链接</h2></div><button class="button button-secondary" type="button" @click="resources.push(newResource())">+ 添加格式</button></div>
        <div v-for="(resource, index) in resources" :key="index" class="resource-editor"><div class="resource-editor-heading"><h3>资源 {{ index + 1 }}</h3><button v-if="resources.length > 1" class="button button-text danger" type="button" @click="resources.splice(index, 1)">移除</button></div><div class="form-grid"><label>格式<input v-model="resource.format" :name="`format-${index}`" placeholder="PDF / HTML"></label><label>链接类型<select v-model="resource.linkType"><option value="source">来源链接</option><option value="drive">本站网盘</option></select></label><label class="wide">资源 URL<input v-model="resource.url" :name="`resource-url-${index}`" type="url" placeholder="https://"></label><label>来源名称<input v-model="resource.sourceName" :name="`source-name-${index}`"></label><label>来源页面<input v-model="resource.sourceUrl" type="url"></label><label>提取码<input v-model="resource.accessCode"></label><label>核验日期<input v-model="resource.verifiedAt" type="date"></label></div></div>
      </section>
      <div class="editor-actions"><button class="button button-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存试卷' }}</button><button v-if="savedId" class="button button-secondary" type="button" :disabled="saving" @click="changeStatus">{{ status === 'draft' ? '确认并发布' : '下架试卷' }}</button><RouterLink v-if="savedId" class="text-link" :to="`/admin/papers/${savedId}`">查看编辑页 ↗</RouterLink></div>
    </form>
  </main>
</template>
