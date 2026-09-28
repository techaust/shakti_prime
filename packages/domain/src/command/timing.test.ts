import { DomainError } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../ports/logger';
import { SLOW_CALL_MS, timed, type Clock } from './timing';

/** A clock that answers each reading from the list, then stays on the last one. */
function fakeClock(...readings: number[]): Clock {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)] ?? 0;
}

describe('timed', () => {
  it('logs one info line with the name, outcome, duration and request id', async () => {
    const logger = memoryLogger();
    const answer = await timed(
      'command',
      'crm.lead.create',
      'req-1',
      { logger, clock: fakeClock(1000, 1042.37) },
      () => Promise.resolve('done'),
    );
    expect(answer).toBe('done');
    expect(logger.entries).toEqual([
      {
        level: 'info',
        event: 'command.completed',
        fields: { name: 'crm.lead.create', outcome: 'ok', durationMs: 42.4, requestId: 'req-1' },
      },
    ]);
  });

  it('logs at warn above the 300 ms target and at info on it', async () => {
    const logger = memoryLogger();
    const options = (end: number) => ({ logger, clock: fakeClock(0, end) });
    await timed('query', 'listLeads', 'r', options(SLOW_CALL_MS), () => Promise.resolve(1));
    await timed('query', 'listLeads', 'r', options(SLOW_CALL_MS + 0.1), () => Promise.resolve(1));
    expect(logger.entries.map((e) => [e.level, e.event, e.fields.durationMs])).toEqual([
      ['info', 'query.completed', 300],
      ['warn', 'query.completed', 300.1],
    ]);
  });

  it('records a refusal as denied and any other error as failed, and rethrows it', async () => {
    const logger = memoryLogger();
    const clock = fakeClock(0, 5, 10, 15, 20, 25);
    const forbidden = new DomainError('forbidden', 'no grant');
    await expect(
      timed('command', 'admin.user.invite', 'r1', { logger, clock }, () =>
        Promise.reject(forbidden),
      ),
    ).rejects.toBe(forbidden);
    await expect(
      timed('command', 'crm.lead.create', 'r2', { logger, clock }, () =>
        Promise.reject(new DomainError('conflict', 'taken')),
      ),
    ).rejects.toThrow('taken');
    await expect(
      timed('query', 'listLeads', 'r3', { logger, clock }, () =>
        Promise.reject(new Error('connection lost')),
      ),
    ).rejects.toThrow('connection lost');
    expect(logger.entries.map((e) => e.fields)).toEqual([
      {
        name: 'admin.user.invite',
        outcome: 'denied',
        errorCode: 'forbidden',
        durationMs: 5,
        requestId: 'r1',
      },
      {
        name: 'crm.lead.create',
        outcome: 'failed',
        errorCode: 'conflict',
        durationMs: 5,
        requestId: 'r2',
      },
      { name: 'listLeads', outcome: 'failed', errorCode: 'internal', durationMs: 5, requestId: 'r3' },
    ]);
  });

  it('when quiet, keeps the slow lines and drops the rest', async () => {
    const logger = memoryLogger();
    const quiet = (end: number) => ({ logger, clock: fakeClock(0, end), quiet: true });
    await timed('query', 'fast', 'r', quiet(12), () => Promise.resolve(1));
    await timed('query', 'slow', 'r', quiet(480), () => Promise.resolve(1));
    expect(logger.entries.map((e) => [e.level, e.fields.name])).toEqual([['warn', 'slow']]);
  });

  it('a logger that throws never changes the answer or the error', async () => {
    const broken = {
      log() {
        throw new Error('log sink down');
      },
    };
    await expect(
      timed('query', 'q', 'r', { logger: broken, clock: fakeClock(0, 1) }, () =>
        Promise.resolve('answer'),
      ),
    ).resolves.toBe('answer');
    await expect(
      timed('query', 'q', 'r', { logger: broken, clock: fakeClock(0, 1) }, () =>
        Promise.reject(new DomainError('not_found', 'gone')),
      ),
    ).rejects.toThrow('gone');
  });
});
