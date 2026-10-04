import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_TYPES, isSubscribed } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { describeSchema, renderEventsDoc } from './events-docs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const lf = (text: string) => text.replace(/\r\n/g, '\n');

describe('the event catalogue document (docs/data/EVENTS.md)', () => {
  const doc = renderEventsDoc();

  it('matches the event catalogue; run pnpm db:docs when not', () => {
    expect(lf(readFileSync(join(repoRoot, 'docs', 'data', 'EVENTS.md'), 'utf8'))).toBe(doc);
  });

  it('lists every type once, with its worker route exactly when it is subscribed', () => {
    for (const type of EVENT_TYPES) {
      expect(doc.match(new RegExp(`^### ${type.replace(/\./g, '\\.')}$`, 'gm'))).toHaveLength(1);
      expect(doc.includes(`POST /api/v1/workers/outbox/${type}\``)).toBe(isSubscribed(type));
    }
    expect(doc).toContain('`POST /api/v1/workers/outbox/files.file.uploaded`');
    expect(doc).toContain('`POST /api/v1/workers/outbox/platform.probe.requested`');
  });
});

describe('describeSchema', () => {
  it('reads the shapes the payloads use', () => {
    expect(describeSchema({ anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] })).toBe(
      'id or null',
    );
    expect(describeSchema({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER })).toBe(
      'whole number from 0',
    );
    expect(describeSchema({ type: 'integer', minimum: 1, maximum: 720 })).toBe(
      'whole number from 1 to 720',
    );
    expect(describeSchema({ type: 'string', const: 'admin' })).toBe('always `admin`');
    expect(describeSchema({ type: 'string', minLength: 1, maxLength: 40 })).toBe(
      'text from 1 to 40 characters',
    );
    expect(
      describeSchema({ type: 'array', minItems: 1, items: { type: 'string', enum: ['gstin'] } }),
    ).toBe('list of values from `gstin`, at least 1');
    expect(describeSchema({ type: 'boolean' })).toBe('true or false');
  });
});
