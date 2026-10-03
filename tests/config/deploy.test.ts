import { describe, expect, it, vi } from 'vitest';
import { runDeployment } from '../../scripts/deploy';

describe('production deployment gate', () => {
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
      [['d1', 'migrations', 'apply', 'ceepp', '--remote']],
      [['deploy']],
    ]);
  });

  it('does not publish when a migration fails', async () => {
    const run = vi.fn(async (_args: string[]) => { throw new Error('migration failed'); });

    await expect(runDeployment({ workersCi: true, branch: 'main' }, run))
      .rejects.toThrow('migration failed');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
