import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The voice worker's token is accepted only where live voice needs it (docs/07-security.md §3.4):
// a voice session acts as its person, so every route that takes the token widens what a session
// can do. The modules that read the token, and the routes that reach them, are listed here; a new
// one fails this test until it is added with its reason.

const src = fileURLToPath(new URL('../', import.meta.url));

/** The modules that check a voice token or build a voice principal from one, and why. */
const READERS: Readonly<Record<string, string>> = {
  'voice/token.ts': 'signs and checks the token',
  'auth/voice-principal.ts': 'the voice principal from a checked token, for a live session',
  'voice/route-deps.ts':
    "the voice routes: a session start, the worker token refresh and a Teach session's recording",
  'ask/route-deps.ts': "Ask's bearer seam: the worker's spoken answers",
};

/** The routes that may take the voice token, through the readers above. */
const ROUTES = [
  // Ask's spoken answers, as the person.
  'app/api/v1/ask/route.ts',
  // Starts a session (the cookie); its module also builds the worker routes below.
  'app/api/v1/voice/session/route.ts',
  // The worker's own token, while its session is live.
  'app/api/v1/voice/token/route.ts',
  // A recorded Teach session's audio, uploaded and filed as the person, once per session.
  'app/api/v1/voice/recording/route.ts',
  'app/api/v1/voice/recording/complete/route.ts',
];

const TOKEN_READ = /\b(verifyVoiceToken|voicePrincipalFromToken)\b/;

function sources(): string[] {
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
}

const read = (path: string) => readFileSync(`${src}${path}`, 'utf8');

/** The `src`-relative paths a file imports by a relative specifier. */
function relativeImports(path: string): string[] {
  const dir = path.split('/').slice(0, -1);
  return [...read(path).matchAll(/from '(\.{1,2}\/[^']+)'/g)].map((m) => {
    const parts = [...dir];
    for (const part of (m[1] ?? '').split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    return `${parts.join('/')}.ts`;
  });
}

describe('the routes that take the voice token', () => {
  it('are read only by the modules listed', () => {
    const readers = sources().filter((path) => TOKEN_READ.test(read(path)));
    expect(readers.sort()).toEqual(Object.keys(READERS).sort());
  });

  it('are exactly the routes listed', () => {
    const readers = new Set(Object.keys(READERS));
    const routes = sources().filter(
      (path) =>
        path.startsWith('app/') &&
        path.endsWith('/route.ts') &&
        relativeImports(path).some((imported) => readers.has(imported)),
    );
    expect(routes.sort()).toEqual([...ROUTES].sort());
  });

  it('reach the readers only from the routes and the readers themselves', () => {
    const readers = new Set(Object.keys(READERS));
    const importers = sources().filter((path) =>
      relativeImports(path).some((imported) => readers.has(imported)),
    );
    const allowed = new Set([...ROUTES, ...readers, 'voice/handlers.ts']);
    expect(importers.filter((path) => !allowed.has(path)).sort()).toEqual([]);
  });
});
