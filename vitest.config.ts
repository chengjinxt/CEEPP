import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['apps/web/tests/**/*.test.ts', 'apps/crawler/tests/**/*.test.ts', 'tests/config/**/*.test.ts'],
  },
});
