<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { getPaper } from '../api';
import type { PaperDetail } from '../api';
import { safeHttpUrl } from '../urls';
import { ORIGIN_TYPE_LABELS, RESOURCE_KIND_LABELS, SUBJECT_ROLE_LABELS } from '../../shared/exam';

const route = useRoute();
const paper = ref<PaperDetail | null>(null);
const error = ref('');
const loading = ref(true);

function sameSiteFileUrl(value?: string | null): string | null {
  if (!value) return null;
  return /^\/api\/resources\/\d+\/file(?:\?download=1)?$/u.test(value) ? value : null;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function load(): Promise<void> {
  paper.value = null;
  error.value = '';
  loading.value = true;
  const id = Number(route.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    error.value = '试卷编号无效';
    loading.value = false;
    return;
  }
  try {
    paper.value = await getPaper(id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取试卷失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(() => route.params.id, () => void load());
</script>

<template>
  <main class="container detail-page">
    <nav class="breadcrumb" aria-label="面包屑"><RouterLink to="/">试卷资料库</RouterLink><span>/</span><span>试卷详情</span></nav>
    <div v-if="loading" class="state-panel" role="status">正在读取试卷…</div>
    <div v-else-if="error" class="state-panel state-error" role="alert">{{ error }} <button type="button" @click="load">重试</button></div>
    <template v-else-if="paper">
      <section class="detail-hero">
        <p class="eyebrow">PAPER DETAIL · {{ paper.year }}</p>
        <h1>{{ paper.title }}</h1>
        <div class="detail-tags"><span>{{ ORIGIN_TYPE_LABELS[paper.originType] }}</span><span>{{ paper.series }}</span><span>{{ paper.subject }}</span><span>{{ SUBJECT_ROLE_LABELS[paper.subjectRole] }}</span></div>
      </section>
      <div class="detail-layout">
        <section class="detail-main" aria-labelledby="resource-heading">
          <div class="section-heading"><div><p class="eyebrow">AVAILABLE FILES</p><h2 id="resource-heading">可用资料</h2></div></div>
          <p class="detail-intro">本站 PDF 可直接在线查看或下载；外部资源会前往原始来源或分享页面。</p>
          <div v-if="paper.resources.length === 0" class="state-panel"><h3>暂无可用资源</h3><p>这份试卷的信息已收录，资源链接正在补齐。</p></div>
          <article v-for="resource in paper.resources" :key="resource.id" class="resource-card">
            <div class="resource-format">{{ resource.format }}</div>
            <div class="resource-copy">
              <h3><span class="resource-kind">{{ RESOURCE_KIND_LABELS[resource.kind || 'question'] }}</span> · {{ resource.format }}</h3>
              <p>{{ resource.linkType === 'upload' ? '本站文件' : resource.linkType === 'drive' ? '网盘分享' : '来源链接' }}<span v-if="resource.sourceName"> · {{ resource.sourceName }}</span><span v-if="resource.linkType === 'upload' && resource.sizeBytes !== null"> · {{ fileSize(resource.sizeBytes) }}</span></p>
              <p v-if="resource.fileName" class="uploaded-filename">{{ resource.fileName }}</p>
              <a v-if="safeHttpUrl(resource.sourceUrl)" class="resource-source" :href="safeHttpUrl(resource.sourceUrl)!" target="_blank" rel="noopener noreferrer">查看出处 ↗</a>
              <p v-if="resource.accessCode" class="access-code">提取码 <strong>{{ resource.accessCode }}</strong></p>
              <p v-if="resource.verifiedAt" class="verified-date">核验于 {{ resource.verifiedAt.slice(0, 10) }}</p>
            </div>
            <div v-if="resource.linkType === 'upload' && sameSiteFileUrl(resource.url)" class="resource-actions">
              <a class="button button-primary" :href="sameSiteFileUrl(resource.url)!" target="_blank" rel="noopener noreferrer" :aria-label="`在线查看 ${resource.fileName || resource.format}`">在线查看 ↗</a>
              <a v-if="sameSiteFileUrl(resource.downloadUrl)" class="button button-secondary" :href="sameSiteFileUrl(resource.downloadUrl)!" :aria-label="`下载 ${resource.fileName || resource.format}`">下载 PDF</a>
            </div>
            <a v-else-if="safeHttpUrl(resource.url)" class="button button-primary" :href="safeHttpUrl(resource.url)!" target="_blank" rel="noopener noreferrer">打开资源 ↗</a>
            <span v-else class="resource-unavailable">链接暂不可用</span>
          </article>
        </section>
        <aside class="detail-aside">
          <h2>试卷信息</h2>
          <dl><div><dt>年份</dt><dd>{{ paper.year }}</dd></div><div><dt>命题范围</dt><dd>{{ ORIGIN_TYPE_LABELS[paper.originType] }}</dd></div><div><dt>试卷系列</dt><dd>{{ paper.series }}</dd></div><div><dt>科目</dt><dd>{{ paper.subject }}</dd></div><div><dt>科目角色</dt><dd>{{ SUBJECT_ROLE_LABELS[paper.subjectRole] }}</dd></div><div><dt>适用地区</dt><dd>{{ paper.regions.length ? paper.regions.join('、') : '以试卷信息为准' }}</dd></div></dl>
          <RouterLink to="/">← 返回查找</RouterLink>
        </aside>
      </div>
    </template>
  </main>
</template>
