import { HealthResponse } from '@shakti/contracts';

export const dynamic = 'force-dynamic';

const COMMIT = /^[0-9a-f]{40}$/;

/** The commit Vercel built this deployment from; null anywhere else (a developer's machine, CI). */
function deployedCommit(env: NodeJS.ProcessEnv = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? '';
  return COMMIT.test(sha) ? sha : null;
}

/** Liveness: the function is up. No dependency is touched (docs/06-api.md §3.7). */
export function GET(): Response {
  const body = HealthResponse.parse({
    status: 'ok',
    time: new Date().toISOString(),
    commit: deployedCommit(),
  });
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
