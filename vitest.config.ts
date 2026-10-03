import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['tests/client/**/*.test.ts', 'tests/crawl/**/*.test.ts', 'tests/config/**/*.test.ts'],
  },
});
