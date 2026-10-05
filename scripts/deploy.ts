import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DeployContext {
  workersCi: boolean;
  branch?: string;
}

export type WranglerRunner = (args: string[]) => Promise<void>;

export async function runDeployment(context: DeployContext, run: WranglerRunner): Promise<void> {
  if (context.branch !== 'main') {
    throw new Error('Production deployment is allowed only from main.');
  }

  await run(['d1', 'migrations', 'apply', 'ceepp', '--remote', '--config', 'apps/worker/wrangler.jsonc']);
  await run(['deploy']);
}

async function runWrangler(args: string[]): Promise<void> {
  const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workersCi = process.env.WORKERS_CI === '1';
  const localBranch = workersCi ? undefined : spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
  runDeployment(
    {
      workersCi,
      branch: workersCi ? process.env.WORKERS_CI_BRANCH : localBranch?.status === 0 ? localBranch.stdout.trim() : undefined,
    },
    runWrangler,
  ).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
