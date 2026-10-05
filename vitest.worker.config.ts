import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(projectRoot, 'apps/worker/wrangler.jsonc') },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(projectRoot, 'apps/worker/migrations')),
        },
      },
    })),
  ],
  test: {
    include: ['apps/worker/tests/**/*.test.ts'],
  },
});
