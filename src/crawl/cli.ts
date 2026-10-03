import type { Candidate } from './types';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { crawlGitHub } from './github';
import { crawlUrongda } from './urongda';
import { upsertCandidates } from './persist';

interface Options {
  github: () => Promise<Candidate[]>;
  urongda: () => Promise<Candidate[]>;
  persist: (items: Candidate[]) => Promise<number>;
  dryRun: boolean;
}

export async function runCrawl(options: Options): Promise<{
  discovered: number;
  stored: number;
  bySource: { gaokaomath: number; urongda: number };
  failures: string[];
}> {
  const sources = await Promise.allSettled([options.github(), options.urongda()]);
  const candidates: Candidate[] = [];
  const failures: string[] = [];
  const bySource = { gaokaomath: 0, urongda: 0 };
  for (const [index, result] of sources.entries()) {
    if (result.status === 'fulfilled') {
      bySource[index === 0 ? 'gaokaomath' : 'urongda'] = result.value.length;
      candidates.push(...result.value);
    }
    else failures.push(`${index === 0 ? 'gaokaomath' : 'urongda'}: ${String(result.reason instanceof Error ? result.reason.message : result.reason)}`);
  }
  let stored = 0;
  if (!options.dryRun && candidates.length) {
    try {
      stored = await options.persist(candidates);
    } catch (error) {
      failures.push(`D1: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { discovered: candidates.length, stored, bySource, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!dryRun && (!accountId || !databaseId || !apiToken)) {
    console.error('Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, or CLOUDFLARE_API_TOKEN');
    process.exitCode = 1;
  } else {
    const summary = await runCrawl({
      github: () => crawlGitHub({ token: process.env.GITHUB_TOKEN }),
      urongda: () => crawlUrongda(),
      persist: (items) => upsertCandidates(items, { accountId: accountId!, databaseId: databaseId!, apiToken: apiToken! }),
      dryRun,
    });
    console.info(`Candidates found: ${summary.discovered} (gaokaomath: ${summary.bySource.gaokaomath}; urongda: ${summary.bySource.urongda}); D1 processed: ${summary.stored}`);
    if (summary.failures.length) {
      for (const failure of summary.failures) console.error(failure);
      process.exitCode = 1;
    }
  }
}
