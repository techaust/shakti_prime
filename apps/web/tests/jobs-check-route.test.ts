import { JobsCheckWorkerResponse, newId } from '@shakti/contracts';
import { closeDb } from '@shakti/db/testing';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The hourly jobs check's route with the Phase 2 alerts failing (the lead, 20-11-2026): the run
// still answers 200, so the job's streak is not held at failing and its check-in is sent as ok.
// The signature check, the jobs' read and the database are real; the check-in and the Phase 2
// run are stood in for.

const checkIns = vi.hoisted(() => [] as { job: string; status: string }[]);
vi.mock('../src/observability/check-ins', async (original) => ({
  ...(await original<typeof import('../src/observability/check-ins')>()),
  sendCheckIn: (job: string, status: string) => {
    checkIns.push({ job, status });
    return Promise.resolve();
  },
}));
vi.mock('../src/workers/phase2-alerts', async (original) => ({
  ...(await original<typeof import('../src/workers/phase2-alerts')>()),
  runPhase2Alerts: () =>
    Promise.reject(new Error('platform.jobs.check:all is required (stood in for a refused read)')),
}));

const { POST } = await import('../src/app/api/v1/workers/jobs/check/route');

afterAll(async () => {
  await closeDb();
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'jobs-check-route-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/jobs/check';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'jobs-check-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'jobs-check-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the route and the body's hash. */
function sign(body: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: ROUTE_URL,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: newId(),
      body: createHash('sha256').update(body).digest('base64url'),
    }),
  );
  const signature = createHmac('sha256', CURRENT_KEY)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${signature}`;
}

describe('POST /api/v1/workers/jobs/check with the Phase 2 alerts failing', () => {
  it('answers 200 with the fault counted, and checks in the scheduled call as ok', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'upstash-signature': sign('{}'),
      'upstash-schedule-id': 'jobs-check-test',
    });
    const response = await POST(new Request(ROUTE_URL, { method: 'POST', headers, body: '{}' }));
    expect(response.status).toBe(200);
    const answer = JobsCheckWorkerResponse.parse(await response.json());
    expect(answer.problems).toBeGreaterThanOrEqual(1);
    expect(checkIns).toEqual([{ job: 'jobs-check', status: 'ok' }]);
  });
});
