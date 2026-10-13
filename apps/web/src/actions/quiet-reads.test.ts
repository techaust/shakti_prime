import { describe, expect, it, vi } from 'vitest';

// The two ways an action finds its caller, told apart: a person's own use answers nobody here, the
// quiet read answers the caller. An action that resolves through `signedIn()` therefore fails with
// `unauthorized`, and only one that reads quietly reaches its query (WEB-8).
const caller = vi.hoisted(() => ({
  id: '01990000-0000-7000-8000-00000000c001',
  entityIds: [1],
  permissions: [],
}));
const resolvers = vi.hoisted(() => ({
  loud: vi.fn(() => Promise.resolve(undefined)),
  quiet: vi.fn(() => Promise.resolve(caller)),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock('../workers/outbox', () => ({ nudgeOutbox: () => undefined }));
vi.mock('../auth/current-principal', () => ({
  currentPrincipal: resolvers.loud,
  currentPrincipalQuietly: resolvers.quiet,
  currentSession: () => Promise.resolve(undefined),
  currentPrincipalIn: () => Promise.resolve(undefined),
}));
vi.mock('@shakti/domain', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  executeQuery: vi.fn(() => Promise.resolve({ marker: 'read' })),
}));

const { noticeCount } = await import('./notifications');
const { getImportJob } = await import('./imports');
const { recheckKnowledgeFiles } = await import('./knowledge');

describe('the background reads never extend the session (WEB-8)', () => {
  it.each([
    ['the bell’s count', () => noticeCount()],
    [
      'the import progress check',
      () => getImportJob({ entityId: 1, jobId: '01990000-0000-7000-8000-00000000c002' }),
    ],
    ['the vault’s re-read', () => recheckKnowledgeFiles()],
  ])('%s resolves its caller quietly', async (_name, read) => {
    resolvers.loud.mockClear();
    resolvers.quiet.mockClear();
    const result = await read();
    expect(result).toMatchObject({ ok: true });
    expect(resolvers.quiet).toHaveBeenCalled();
    expect(resolvers.loud).not.toHaveBeenCalled();
  });
});
