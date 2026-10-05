<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <div class="container header-inner">
        <RouterLink class="brand" to="/" aria-label="CEEPP 高考真题库首页"><span class="brand-mark">C</span><span class="brand-copy"><strong>CEEPP</strong><small>高考真题库</small></span></RouterLink>
        <nav class="main-nav" aria-label="主导航"><RouterLink to="/">找试卷</RouterLink><RouterLink to="/guide/scope">普通高考</RouterLink><RouterLink to="/guide/terms">名词解释</RouterLink><RouterLink to="/guide/history">改革简史</RouterLink></nav>
        <a class="header-admin" href="/admin">管理后台 <span aria-hidden="true">↗</span></a>
      </div>
    </header>
    <RouterView />
    <footer class="site-footer"><div class="container footer-inner"><div><span class="footer-brand">CEEPP</span><p>让历年真题更容易找到。</p></div><div class="footer-links"><RouterLink to="/">试卷资料库</RouterLink><RouterLink to="/guide/scope">收录范围</RouterLink><a href="/admin">管理后台</a></div><small>资料链接与出处均展示于试卷详情页。请以官方考试信息为准。</small></div></footer>
  </div>
</template>
