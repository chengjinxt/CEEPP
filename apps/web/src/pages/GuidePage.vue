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
    title: '命题范围、卷别与选科，怎么区分？',
    intro: '命题范围、科目角色和适用地区是三个不同维度。只有把年份和具体科目一起核对，才能准确判断一份试卷适用于谁。',
    sections: [
      { title: '命题方式不等于选科方式', body: '“全国统一命题、省级自主命题、多地联合命题”说明谁负责命题；“统一高考科目、首选科目、再选科目、3+3 选考科目”说明科目在考试方案中的角色。两者不能互相替代，例如一个省可以在语数外使用全国统一命题卷，同时对选考科目自主命题。' },
      { title: '3+1+2 的三类科目', body: '“3”是语文、数学、外语等统一高考科目；“1”是考生从物理、历史中选择的首选科目；“2”是从思想政治、地理、化学、生物学中选择的再选科目。本站会分别标注科目角色和命题范围。' },
      { title: '全国卷要同时看年份与科目', body: '全国卷与适用地区的对应关系会随年份和科目变化。同一年某地区的语文、数学、外语可能使用全国一卷或全国二卷，但首选、再选科目仍可能由本省自主命题或由多地联合命题，因此不能把全国卷的地区预设套到所有科目。' },
      { title: '综合科目不是新高考选考', body: '文科综合、理科综合不是新高考选考科目，它们属于传统文理分科方案下的综合科目。查找历史试卷时应按当年的考试方案识别，不能与 3+1+2 的首选、再选科目或 3+3 选考科目混用。' },
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
