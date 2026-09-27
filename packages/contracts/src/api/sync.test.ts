import { describe, expect, it } from 'vitest';
import { newId } from '../ids';
import { API_FIXTURES, IDS } from './fixtures';
import { SyncPullQuery, SyncPullResponse, SyncPushRequest, SyncPushResponse } from './sync';

const push = API_FIXTURES['sync.push'].request as { commands: Record<string, unknown>[] };

describe('sync pull', () => {
  it('starts a full pull without a cursor and caps the page', () => {
    expect(SyncPullQuery.parse({})).toEqual({ limit: 500 });
    expect(SyncPullQuery.safeParse({ limit: '5000' }).success).toBe(false);
  });

  it('refuses a change for a collection the app does not keep', () => {
    const response = API_FIXTURES['sync.pull'].response as { changes: object[] };
    const change = { ...response.changes[0], collection: 'item_costs' };
    expect(SyncPullResponse.safeParse({ ...response, changes: [change] }).success).toBe(false);
  });

  it('sends a removal without a record', () => {
    const response = SyncPullResponse.parse(API_FIXTURES['sync.pull'].response);
    expect(response.changes.find((c) => c.op === 'delete')).not.toHaveProperty('record');
  });
});

describe('sync push', () => {
  it('needs one idempotency key per command', () => {
    const [first] = push.commands;
    expect(SyncPushRequest.safeParse({ commands: [first, first] }).success).toBe(false);
  });

  it('takes at most 100 commands in one batch', () => {
    const commands = Array.from({ length: 101 }, () => ({
      ...push.commands[0],
      idempotencyKey: crypto.randomUUID(),
    }));
    expect(SyncPushRequest.safeParse({ commands }).success).toBe(false);
    expect(SyncPushRequest.safeParse({ commands: [] }).success).toBe(false);
  });

  it('names commands the way the registry does', () => {
    const command = { ...push.commands[0], name: 'DROP TABLE' };
    expect(SyncPushRequest.safeParse({ commands: [command] }).success).toBe(false);
  });

  it('answers applied, replayed, conflict, rejected or held for each command', () => {
    const results = [
      { idempotencyKey: IDS.commandA, id: newId(), status: 'replayed', output: {} },
      {
        idempotencyKey: IDS.commandB,
        id: newId(),
        status: 'rejected',
        error: { code: 'forbidden', reason: 'not_assigned' },
      },
    ];
    expect(
      SyncPushResponse.safeParse({ results, serverTime: '2026-09-27T09:02:11Z' }).success,
    ).toBe(true);
    const unknown = [{ idempotencyKey: IDS.commandA, id: newId(), status: 'ignored' }];
    expect(
      SyncPushResponse.safeParse({ results: unknown, serverTime: '2026-09-27T09:02:11Z' }).success,
    ).toBe(false);
  });
});
