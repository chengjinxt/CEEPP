import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectRoot, 'apps/web'),
  plugins: [
    vue(),
    cloudflare({ configPath: path.join(projectRoot, 'apps/worker/wrangler.jsonc') }),
  ],
  build: {
    outDir: path.join(projectRoot, 'dist'),
    emptyOutDir: true,
  },
});
