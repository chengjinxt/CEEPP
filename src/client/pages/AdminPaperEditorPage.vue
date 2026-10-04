<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  deletePaperResource, getAdminPaper, savePaper, setPaperStatus, uploadPaperPdf,
} from '../api';
import type { PaperInput, PaperResource, PaperStatus, ResourceInput, Scope } from '../api';
import {
  EXAM_REGIONS, EXAM_SUBJECTS, ORIGIN_TYPE_LABELS, RESOURCE_KIND_LABELS,
  SUBJECT_ROLE_LABELS, seriesRegions,
} from '../../shared/exam';
import type { OriginType, ResourceKind, SubjectRole } from '../../shared/exam';

interface ResourceDraft {
  format: string;
  kind: ResourceKind;
  url: string;
  linkType: 'source' | 'drive';
  sourceName: string;
  sourceUrl: string;
  accessCode: string;
  verifiedAt: string;
}

const route = useRoute();
const paperId = computed(() => route.params.id ? Number(route.params.id) : null);
const savedId = ref<number | null>(null);
const status = ref<PaperStatus>('draft');
const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const deletingId = ref<number | null>(null);
const error = ref('');
const notice = ref('');
const form = reactive({
  title: '', year: '', originType: 'unknown' as OriginType, series: '', subject: '',
  subjectRole: 'other' as SubjectRole, regions: [] as string[],
});
const resources = ref<ResourceDraft[]>([newResource()]);
const uploadedResources = ref<PaperResource[]>([]);
const uploadKind = ref<ResourceKind>('question');
const originOptions = Object.entries(ORIGIN_TYPE_LABELS) as [OriginType, string][];
const subjectRoleOptions = Object.entries(SUBJECT_ROLE_LABELS) as [SubjectRole, string][];
const resourceKindOptions = Object.entries(RESOURCE_KIND_LABELS) as [ResourceKind, string][];
const presetRegions = computed(() => form.originType === 'national'
  ? seriesRegions(Number(form.year), form.series, form.subjectRole)
  : []);
const presetDescription = computed(() => form.subjectRole === 'integrated'
  ? '此预设仅适用于文科综合、理科综合，不适用于新高考选考科目。'
  : '此预设仅适用于语文、数学、外语等统一高考主科，选考科目须按实际命题范围填写。');
const appliedRegionPreset = ref(false);
const appliedRegionPresetKey = ref('');
let loadNumber = 0;

function newResource(): ResourceDraft {
  return {
    format: 'PDF', kind: 'question', url: '', linkType: 'source', sourceName: '',
    sourceUrl: '', accessCode: '', verifiedAt: '',
  };
}

function derivedScope(originType: OriginType): Scope {
  return originType === 'national' ? 'national' : 'regional';
}

function regionPresetKey(): string {
  return JSON.stringify([form.year, form.originType, form.series.trim(), form.subjectRole]);
}

function sameRegionSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((region, index) => region === sortedRight[index]);
}

function reset(): void {
  savedId.value = null;
  status.value = 'draft';
  form.title = '';
  form.year = '';
  form.originType = 'unknown';
  form.series = '';
  form.subject = '';
  form.subjectRole = 'other';
  form.regions = [];
  resources.value = [newResource()];
  uploadedResources.value = [];
  appliedRegionPreset.value = false;
  appliedRegionPresetKey.value = '';
}

async function load(): Promise<void> {
  const current = ++loadNumber;
  if (!paperId.value || !Number.isSafeInteger(paperId.value)) {
    reset();
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
    form.title = paper.title;
    form.year = String(paper.year);
    form.originType = paper.originType ?? (paper.scope === 'national' ? 'national' : 'provincial');
    form.series = paper.series;
    form.subject = paper.subject;
    form.subjectRole = paper.subjectRole ?? 'other';
    form.regions = [...paper.regions];
    const loadedPreset = form.originType === 'national'
      ? seriesRegions(Number(form.year), form.series, form.subjectRole)
      : [];
    appliedRegionPreset.value = loadedPreset.length > 0 && sameRegionSet(form.regions, loadedPreset);
    appliedRegionPresetKey.value = appliedRegionPreset.value ? regionPresetKey() : '';
    uploadedResources.value = paper.resources.filter((resource) => resource.linkType === 'upload');
    const external = paper.resources.filter((resource) => resource.linkType !== 'upload');
    resources.value = external.length ? external.map((resource) => ({
      format: resource.format,
      kind: resource.kind ?? 'question',
      url: resource.url,
      linkType: resource.linkType as 'source' | 'drive',
      sourceName: resource.sourceName || '',
      sourceUrl: resource.sourceUrl || '',
      accessCode: resource.accessCode || '',
      verifiedAt: resource.verifiedAt?.slice(0, 10) || '',
    })) : [newResource()];
  } catch (cause) {
    if (current === loadNumber) error.value = cause instanceof Error ? cause.message : '读取试卷失败';
  } finally {
    if (current === loadNumber) loading.value = false;
  }
}

function input(): PaperInput {
  const entries: ResourceInput[] = resources.value
    .filter((resource) => resource.url.trim())
    .map((resource) => ({
      format: resource.format.trim(),
      kind: resource.kind,
      url: resource.url.trim(),
      linkType: resource.linkType,
      ...(resource.sourceName.trim() ? { sourceName: resource.sourceName.trim() } : {}),
      ...(resource.sourceUrl.trim() ? { sourceUrl: resource.sourceUrl.trim() } : {}),
      ...(resource.accessCode.trim() ? { accessCode: resource.accessCode.trim() } : {}),
      ...(resource.verifiedAt ? { verifiedAt: resource.verifiedAt } : {}),
    }));
  return {
    title: form.title.trim(),
    year: Number(form.year),
    scope: derivedScope(form.originType),
    originType: form.originType,
    series: form.series.trim(),
    subject: form.subject.trim(),
    subjectRole: form.subjectRole,
    regions: [...form.regions],
    resources: entries,
  };
}

function applyRegionPreset(): void {
  form.regions = [...presetRegions.value];
  appliedRegionPreset.value = true;
  appliedRegionPresetKey.value = regionPresetKey();
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
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败';
  } finally {
    saving.value = false;
  }
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
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '更新状态失败';
  } finally {
    saving.value = false;
  }
}

async function uploadPdf(event: Event): Promise<void> {
  const inputElement = event.target as HTMLInputElement;
  const file = inputElement.files?.[0];
  inputElement.value = '';
  if (!file || !savedId.value || status.value !== 'draft') return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    error.value = '请选择 PDF 文件';
    return;
  }
  notice.value = '';
  error.value = '';
  uploading.value = true;
  try {
    const uploaded = await uploadPaperPdf(savedId.value, file, uploadKind.value);
    uploadedResources.value.push(uploaded);
    notice.value = 'PDF 已上传，可在线查看';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'PDF 上传失败';
  } finally {
    uploading.value = false;
  }
}

async function removeUpload(resource: PaperResource): Promise<void> {
  if (!savedId.value || status.value !== 'draft') return;
  deletingId.value = resource.id;
  notice.value = '';
  error.value = '';
  try {
    await deletePaperResource(savedId.value, resource.id);
    uploadedResources.value = uploadedResources.value.filter((item) => item.id !== resource.id);
    notice.value = '上传文件已删除';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除上传文件失败';
  } finally {
    deletingId.value = null;
  }
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(() => void load());
watch(() => route.params.id, () => void load());
watch(
  [() => form.year, () => form.originType, () => form.series, () => form.subjectRole],
  () => {
    if (!appliedRegionPreset.value || appliedRegionPresetKey.value === regionPresetKey()) return;
    form.regions = [];
    appliedRegionPreset.value = false;
    appliedRegionPresetKey.value = '';
    notice.value = '分类条件已变化，原地区预设已清除，请重新核对适用地区';
  },
);
</script>

<template>
  <main class="container admin-page">
    <div class="admin-heading">
      <div><p class="eyebrow">ADMIN / EDITOR</p><h1>{{ paperId ? '编辑试卷' : '新增试卷' }}</h1><p>分别记录命题范围、科目角色和适用地区，避免把统考主科与选考科目混为一谈。</p></div>
      <RouterLink class="button button-secondary" to="/admin/papers">← 返回列表</RouterLink>
    </div>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="state-panel">正在读取试卷…</div>
    <form v-else class="editor-layout" @submit.prevent="save">
      <section class="admin-panel editor-main">
        <div class="section-heading">
          <div><p class="eyebrow">BASIC INFORMATION</p><h2>基本信息</h2></div>
          <span class="pill" :class="status === 'published' ? 'pill-success' : ''">{{ status === 'published' ? '已发布' : '草稿' }}</span>
        </div>
        <div class="form-grid">
          <label class="wide">试卷名称<input v-model="form.title" name="title" required placeholder="例如：2025 年全国一卷数学试卷"></label>
          <label>年份<input v-model="form.year" name="year" type="number" min="1950" max="2100" required></label>
          <label>命题范围
            <select v-model="form.originType" name="originType">
              <option v-for="([value, label]) in originOptions" :key="value" :value="value">{{ label }}</option>
            </select>
            <small>说明试题由全国、省级还是多地联合命制。</small>
          </label>
          <label>试卷系列<input v-model="form.series" name="series" required placeholder="例如：全国一卷、北京卷"></label>
          <label>科目<input v-model="form.subject" name="subject" list="editor-subject-options" required placeholder="例如：数学"></label>
          <datalist id="editor-subject-options"><option v-for="subject in EXAM_SUBJECTS" :key="subject" :value="subject" /></datalist>
          <label>科目角色
            <select v-model="form.subjectRole" name="subjectRole">
              <option v-for="([value, label]) in subjectRoleOptions" :key="value" :value="value">{{ label }}</option>
            </select>
            <small>区分统一高考、首选、再选、3+3 选考及综合科目。</small>
          </label>
          <fieldset class="region-fieldset wide">
            <legend>适用地区（可多选）</legend>
            <div v-if="presetRegions.length" class="region-preset">
              <p><strong>{{ form.year }} 年{{ form.series }}：</strong>已有 {{ presetRegions.length }} 个地区预设。{{ presetDescription }}</p>
              <button class="button button-secondary" type="button" :aria-label="`应用 ${form.year} 年${form.series}地区预设`" @click="applyRegionPreset">应用地区预设</button>
            </div>
            <div class="region-options">
              <label v-for="region in EXAM_REGIONS" :key="region"><input v-model="form.regions" name="regions" type="checkbox" :value="region">{{ region }}</label>
            </div>
            <small>适用地区表示这份完全相同的试卷实际在哪些省级行政区使用，不代表这些地区的所有科目都使用同一套卷。</small>
          </fieldset>
        </div>
      </section>

      <section class="admin-panel editor-main">
        <div class="section-heading">
          <div><p class="eyebrow">EXTERNAL RESOURCES</p><h2>外部资源链接</h2></div>
          <button class="button button-secondary" type="button" @click="resources.push(newResource())">+ 添加资源</button>
        </div>
        <div v-for="(resource, index) in resources" :key="index" class="resource-editor">
          <div class="resource-editor-heading"><h3>外部资源 {{ index + 1 }}</h3><button v-if="resources.length > 1" class="button button-text danger" type="button" @click="resources.splice(index, 1)">移除</button></div>
          <div class="form-grid">
            <label>格式<input v-model="resource.format" :name="`format-${index}`" placeholder="PDF / HTML"></label>
            <label>资料内容<select v-model="resource.kind" :name="`resource-kind-${index}`"><option v-for="([value, label]) in resourceKindOptions" :key="value" :value="value">{{ label }}</option></select></label>
            <label>链接类型<select v-model="resource.linkType"><option value="source">来源链接</option><option value="drive">网盘分享</option></select></label>
            <label class="wide">资源 URL<input v-model="resource.url" :name="`resource-url-${index}`" type="url" placeholder="https://"></label>
            <label>来源名称<input v-model="resource.sourceName" :name="`source-name-${index}`"></label>
            <label>来源页面<input v-model="resource.sourceUrl" type="url"></label>
            <label>提取码<input v-model="resource.accessCode"></label>
            <label>核验日期<input v-model="resource.verifiedAt" type="date"></label>
          </div>
        </div>
      </section>

      <section class="admin-panel editor-main upload-panel">
        <div class="section-heading"><div><p class="eyebrow">SITE PDF</p><h2>本站 PDF 文件</h2></div></div>
        <p class="upload-help">上传后文件由本站保存，发布后读者可直接在线查看或下载。</p>
        <p v-if="!savedId" class="upload-guard">请先保存为草稿，再上传 PDF 文件。</p>
        <p v-else-if="status === 'published'" class="upload-guard">已发布文件正在公开访问。请先下架试卷，再上传或删除 PDF。</p>
        <div v-else class="upload-control">
          <label>资料内容<select v-model="uploadKind"><option v-for="([value, label]) in resourceKindOptions" :key="value" :value="value">{{ label }}</option></select></label>
          <label class="file-picker button button-secondary">{{ uploading ? '上传中…' : '选择 PDF 上传' }}<input name="pdf-upload" type="file" accept="application/pdf,.pdf" :disabled="uploading" @change="uploadPdf"></label>
        </div>
        <div v-if="uploadedResources.length" class="uploaded-list">
          <article v-for="resource in uploadedResources" :key="resource.id" class="uploaded-resource-row">
            <div><strong>{{ resource.fileName || `${resource.format} 文件` }}</strong><span>{{ RESOURCE_KIND_LABELS[resource.kind || 'question'] }}<template v-if="resource.sizeBytes !== null"> · {{ fileSize(resource.sizeBytes) }}</template></span></div>
            <div class="uploaded-actions">
              <a class="text-link" :href="resource.url" target="_blank" rel="noopener noreferrer" :aria-label="`在线查看 ${resource.fileName || resource.format}`">在线查看</a>
              <a v-if="resource.downloadUrl" class="text-link" :href="resource.downloadUrl" :aria-label="`下载 ${resource.fileName || resource.format}`">下载</a>
              <button v-if="status === 'draft'" class="button button-text danger" type="button" :disabled="deletingId === resource.id" :aria-label="`删除上传文件 ${resource.fileName || resource.format}`" @click="removeUpload(resource)">删除</button>
            </div>
          </article>
        </div>
      </section>

      <div class="editor-actions">
        <button class="button button-primary" type="submit" :disabled="saving || uploading || deletingId !== null">{{ saving ? '保存中…' : '保存试卷' }}</button>
        <button v-if="savedId" class="button button-secondary" type="button" :disabled="saving || uploading || deletingId !== null" @click="changeStatus">{{ status === 'draft' ? '确认并发布' : '下架试卷' }}</button>
        <RouterLink v-if="savedId" class="text-link" :to="`/admin/papers/${savedId}`">查看编辑页 ↗</RouterLink>
      </div>
    </form>
  </main>
</template>
