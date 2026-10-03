<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

const route = useRoute();
const guides = {
  scope: {
    eyebrow: 'ABOUT THIS LIBRARY',
    title: '这里只收录普通高考真题',
    intro: '本站整理普通高等学校招生全国统一考试及对应地区卷的历年试卷，帮助你按年份、地区和科目查找原题。',
    sections: [
      { title: '普通高考与春季高考', body: '春季高考是一些地区另行组织的招生考试，考试安排、适用对象与普通高考不同。本站的真题资料库只收录普通高考，春季高考试卷不会混入搜索结果。' },
      { title: '资料如何入库', body: '采集到的线索先进入待审核队列。管理员核对试卷分类、名称、地区、资源链接和出处后才发布。历年全科资料将逐步补齐。' },
      { title: '下载与使用', body: '详情页列出可用格式、来源与提取码。资源可能位于外部网站或网盘，访问方式以对应提供方页面为准。' },
    ],
  },
  terms: {
    eyebrow: 'EXAM TERMS',
    title: '全国卷、地区卷，怎么区分？',
    intro: '卷别是查找试卷时常见的线索。按卷系筛选，再结合适用地区和科目，通常能更快找到需要的题目。',
    sections: [
      { title: '全国卷', body: '由国家层面统一命题的试卷常被称为全国卷。不同年份可能存在多个全国卷系列，同一系列也可能用于多个地区；查找时请同时核对年份和适用地区。' },
      { title: '地区卷', body: '部分地区使用自主命题或独立组织的试卷，本站归为地区卷。地区卷的具体科目和适用范围应以当年官方公布的信息为准。' },
      { title: '系列与科目', body: '“新高考 I 卷”等名称用于区分同年不同系列；语文、数学、外语及选考科目单独列出。若同一试卷适用于多个地区，本站只建立一条试卷记录。' },
    ],
  },
  history: {
    eyebrow: 'BRIEF HISTORY',
    title: '高考改革简史',
    intro: '高考制度与试卷结构长期演进，查找旧卷时需要留意当年的命题方式、科目组合与适用地区。',
    sections: [
      { title: '恢复与发展', body: '1977 年恢复高考后，考试与招生制度持续完善。历年试卷的名称和科目设置并不完全一致，本站尽量保留资料原本的标识。' },
      { title: '命题方式变化', body: '不同阶段，全国统一命题和地方自主命题并行。某些年份存在多个全国卷系列，因此只看“全国卷”三个字可能不足以确认试卷。' },
      { title: '新高考阶段', body: '一些地区陆续调整选考与综合科目安排，试卷系列和地区对应关系也会变化。使用真题前，请结合年份、地区、科目核对。' },
    ],
  },
} as const;
const guide = computed(() => guides[route.params.slug as keyof typeof guides] || guides.scope);
</script>

<template>
  <main class="container guide-page">
    <nav class="breadcrumb" aria-label="面包屑"><RouterLink to="/">试卷资料库</RouterLink><span>/</span><span>常识指南</span></nav>
    <section class="guide-hero"><p class="eyebrow">{{ guide.eyebrow }}</p><h1>{{ guide.title }}</h1><p>{{ guide.intro }}</p></section>
    <div class="guide-layout"><article class="guide-article"><section v-for="(section, index) in guide.sections" :key="section.title"><span class="guide-index">0{{ index + 1 }}</span><div><h2>{{ section.title }}</h2><p>{{ section.body }}</p></div></section></article><aside class="guide-aside"><h2>继续了解</h2><RouterLink to="/guide/scope">普通高考范围 ↗</RouterLink><RouterLink to="/guide/terms">卷别名词解释 ↗</RouterLink><RouterLink to="/guide/history">高考改革简史 ↗</RouterLink><RouterLink class="button button-primary" to="/">查找真题 →</RouterLink></aside></div>
  </main>
</template>
