import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runDeployment } from '../../scripts/deploy';

describe('production deployment gate', () => {
  it('keeps candidate collection manual instead of scheduling recurring runs', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/crawl.yml', import.meta.url), 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*schedule:/m);
  });

  it('binds the production Worker to a provisioned D1 database', () => {
    const config = JSON.parse(readFileSync(new URL('../../apps/worker/wrangler.jsonc', import.meta.url), 'utf8')) as {
      d1_databases: Array<{ binding: string; database_name: string; database_id: string }>;
    };

    expect(config.d1_databases).toHaveLength(1);
    expect(config.d1_databases[0]).toMatchObject({ binding: 'DB', database_name: 'ceepp' });
    expect(config.d1_databases[0].database_id).toBe('336ace7b-b8bf-49fe-9e1e-673822d49e7e');
  });

  it('binds uploaded papers to a dedicated KV namespace without any R2 binding', () => {
    const config = JSON.parse(readFileSync(new URL('../../apps/worker/wrangler.jsonc', import.meta.url), 'utf8')) as {
      kv_namespaces?: Array<{ binding: string; id: string }>;
      r2_buckets?: Array<{ binding: string; bucket_name: string }>;
    };

    expect(config.kv_namespaces).toHaveLength(1);
    expect(config.kv_namespaces?.[0]).toMatchObject({ binding: 'PAPER_FILES' });
    expect(config.kv_namespaces?.[0].id).toBe('18332fafefe24709aa6cc132a3dc18a0');
    expect(config.r2_buckets).toBeUndefined();
  });

  it('runs a daily retry for uploaded objects awaiting KV cleanup', () => {
    const config = JSON.parse(readFileSync(new URL('../../apps/worker/wrangler.jsonc', import.meta.url), 'utf8')) as {
      triggers?: { crons?: string[] };
    };

    expect(config.triggers?.crons).toEqual(['17 3 * * *']);
  });

  it('refuses to touch production D1 from a non-main Workers Build', async () => {
    const run = vi.fn(async (_args: string[]) => {});

    await expect(runDeployment({ workersCi: true, branch: 'feature/search' }, run))
      .rejects.toThrow('main');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses Workers Builds without branch metadata', async () => {
    const run = vi.fn(async (_args: string[]) => {});

    await expect(runDeployment({ workersCi: true }, run)).rejects.toThrow('main');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a manual production deployment from a non-main branch', async () => {
    const run = vi.fn(async (_args: string[]) => {});

    await expect(runDeployment({ workersCi: false, branch: 'feature/search' }, run))
      .rejects.toThrow('main');
    expect(run).not.toHaveBeenCalled();
  });

  it('applies migrations before publishing from main', async () => {
    const run = vi.fn(async (_args: string[]) => {});

    await runDeployment({ workersCi: true, branch: 'main' }, run);

    expect(run.mock.calls).toEqual([
      [['d1', 'migrations', 'apply', 'ceepp', '--remote', '--config', 'apps/worker/wrangler.jsonc']],
      [['deploy']],
    ]);
  });

  it('does not publish when a migration fails', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === 'd1') throw new Error('migration failed');
    });

    await expect(runDeployment({ workersCi: true, branch: 'main' }, run))
      .rejects.toThrow('migration failed');
    expect(run.mock.calls).toEqual([[['d1', 'migrations', 'apply', 'ceepp', '--remote', '--config', 'apps/worker/wrangler.jsonc']]]);
  });
});
