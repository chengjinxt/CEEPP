<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { listPapers } from '../api';
import type { Page, PaperFilters, PaperSummary } from '../api';

const filters = reactive<PaperFilters>({ year: '', scope: '', region: '', subject: '', q: '', page: 1 });
const result = ref<Page<PaperSummary> | null>(null);
const loading = ref(false);
const error = ref('');
const years = Array.from({ length: Math.max(new Date().getFullYear() - 1949, 1) }, (_, index) => String(new Date().getFullYear() - index));
const regions = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];
const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '思想政治', '文科综合', '理科综合', '日语', '俄语'];
let requestNumber = 0;

async function load(): Promise<void> {
  const current = ++requestNumber;
  loading.value = true;
  error.value = '';
  try {
    const next = await listPapers({ ...filters });
    if (current === requestNumber) result.value = next;
  } catch (cause) {
    if (current === requestNumber) error.value = cause instanceof Error ? cause.message : '获取试卷失败，请稍后重试';
  } finally {
    if (current === requestNumber) loading.value = false;
  }
}

function search(): void {
  filters.page = 1;
  void load();
}

function turn(page: number): void {
  if (!result.value || page < 1 || page > Math.ceil(result.value.total / result.value.pageSize)) return;
  filters.page = page;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <main>
    <section class="hero container">
      <div class="hero-copy">
        <p class="eyebrow">普通高考 · 历年真题</p>
        <h1>找到想练的<span>那份试卷。</span></h1>
        <p class="lead">按年份、卷别、地区和科目缩小范围，查看经过核对的资料来源，免费打开试卷。</p>
        <a class="text-link" href="#catalog">开始查找 <span aria-hidden="true">↗</span></a>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-orbit art-orbit-outer"></div>
        <div class="art-orbit art-orbit-inner"></div>
        <div class="art-paper paper-back"><span>GAOKAO · ARCHIVE</span><i></i><i></i><i></i></div>
        <div class="art-paper paper-front"><span>2024 / 语文</span><strong>真题</strong><i></i><i></i><i></i></div>
        <div class="art-sticker">FREE<br>ACCESS</div>
      </div>
    </section>

    <section id="catalog" class="catalog container" aria-labelledby="catalog-heading">
      <div class="section-heading">
        <div><p class="eyebrow">PAPER LIBRARY</p><h2 id="catalog-heading">试卷资料库</h2></div>
        <p>筛选条件可组合使用</p>
      </div>
      <form class="filter-panel" aria-label="查找试卷" @submit.prevent="search">
        <label>年份
          <select v-model="filters.year" name="year">
            <option value="">全部年份</option><option v-for="year in years" :key="year" :value="year">{{ year }}</option>
          </select>
        </label>
        <label>卷别
          <select v-model="filters.scope" name="scope">
            <option value="">全部卷别</option><option value="national">全国卷</option><option value="regional">地区卷</option>
          </select>
        </label>
        <label>适用地区
          <select v-model="filters.region" name="region">
            <option value="">全部地区</option><option v-for="region in regions" :key="region" :value="region">{{ region }}</option>
          </select>
        </label>
        <label>科目
          <input v-model="filters.subject" name="subject" list="subject-options" placeholder="输入任意科目">
          <datalist id="subject-options"><option v-for="subject in subjects" :key="subject" :value="subject" /></datalist>
        </label>
        <label class="filter-keyword">试卷名称
          <input v-model="filters.q" name="q" type="search" placeholder="例如：新高考 I 卷 数学">
        </label>
        <button class="button button-primary filter-submit" type="submit">查找试卷 <span aria-hidden="true">→</span></button>
      </form>

      <div class="results-heading" aria-live="polite">
        <h3>查找结果</h3><span v-if="result && !loading">共 {{ result.total }} 份</span>
      </div>
      <div v-if="loading && !result" class="state-panel" role="status">正在加载试卷…</div>
      <div v-else-if="error" class="state-panel state-error" role="alert">{{ error }} <button type="button" @click="load">重试</button></div>
      <div v-else-if="result && result.items.length === 0" class="state-panel">
        <div class="state-icon" aria-hidden="true">⌕</div>
        <h3>没有找到符合条件的试卷</h3>
        <p>试试减少筛选条件，或稍后再来查看新补齐的资料。</p>
      </div>
      <div v-else-if="result" class="paper-list">
        <article v-for="paper in result.items" :key="paper.id" class="paper-card">
          <div class="paper-card-year">{{ paper.year }}<small>YEAR</small></div>
          <div class="paper-card-content">
            <div class="paper-card-meta"><span>{{ paper.scope === 'national' ? '全国卷' : '地区卷' }}</span><span>{{ paper.series }}</span><span>{{ paper.subject }}</span></div>
            <h4><RouterLink :to="`/papers/${paper.id}`">{{ paper.title }}</RouterLink></h4>
            <p>适用地区：{{ paper.regions.length ? paper.regions.join('、') : '以试卷信息为准' }}</p>
          </div>
          <RouterLink class="paper-card-action" :to="`/papers/${paper.id}`" :aria-label="`查看 ${paper.title}`">查看试卷 <span aria-hidden="true">↗</span></RouterLink>
        </article>
      </div>
      <nav v-if="result && result.total > result.pageSize" class="pagination" aria-label="结果分页">
        <button type="button" aria-label="上一页" :disabled="loading || result.page <= 1" @click="turn(result.page - 1)">← 上一页</button>
        <span>第 {{ result.page }} 页 / 共 {{ Math.ceil(result.total / result.pageSize) }} 页</span>
        <button type="button" aria-label="下一页" :disabled="loading || result.page >= Math.ceil(result.total / result.pageSize)" @click="turn(result.page + 1)">下一页 →</button>
      </nav>
    </section>

    <section class="guide-strip container">
      <div><p class="eyebrow">QUICK GUIDE</p><h2>查找之前，先了解这些。</h2></div>
      <div class="guide-links">
        <RouterLink to="/guide/scope">普通高考范围 <span>↗</span></RouterLink>
        <RouterLink to="/guide/terms">卷别名词解释 <span>↗</span></RouterLink>
        <RouterLink to="/guide/history">高考改革简史 <span>↗</span></RouterLink>
      </div>
    </section>
  </main>
</template>
