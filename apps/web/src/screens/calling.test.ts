import type { CallQueueItemDto, DispositionDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  defaultCallbackLocal,
  nextLead,
  outcomeForKey,
  outcomeNeeds,
  shortcutFor,
  suggestedLostReason,
} from './calling';

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => shortcutFor({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('shortcutFor', () => {
  it('maps N, D, / and the number keys', () => {
    expect(key('n')).toEqual({ kind: 'next' });
    expect(key('N')).toEqual({ kind: 'next' });
    expect(key('d')).toEqual({ kind: 'dial' });
    expect(key('/')).toEqual({ kind: 'search' });
    expect(key('1')).toEqual({ kind: 'outcome', key: 1 });
    expect(key('9')).toEqual({ kind: 'outcome', key: 9 });
  });

  it('leaves every other key, and keys with a modifier, to the browser', () => {
    expect(key('0')).toBeUndefined();
    expect(key('x')).toBeUndefined();
    expect(key('Enter')).toBeUndefined();
    expect(key('n', { ctrlKey: true })).toBeUndefined();
    expect(key('d', { metaKey: true })).toBeUndefined();
    expect(key('1', { altKey: true })).toBeUndefined();
  });
});

describe('outcomeNeeds', () => {
  it('asks a callback for its time, a lost lead for its reason, a parked open lead for its reason', () => {
    expect(outcomeNeeds('callback', 'open')).toBe('callbackTime');
    expect(outcomeNeeds('callback', 'nurture')).toBe('callbackTime');
    expect(outcomeNeeds('not_interested', 'open')).toBe('lostReason');
    expect(outcomeNeeds('wrong_number', 'nurture')).toBe('lostReason');
    expect(outcomeNeeds('nurture', 'open')).toBe('nurtureReason');
  });

  it('saves the rest on the key alone', () => {
    expect(outcomeNeeds('retry', 'open')).toBeUndefined();
    expect(outcomeNeeds('qualified', 'open')).toBeUndefined();
    expect(outcomeNeeds('nurture', 'nurture')).toBeUndefined();
  });

  it('suggests a lost reason that fits the outcome', () => {
    expect(suggestedLostReason('wrong_number')).toBe('not_reachable');
    expect(suggestedLostReason('not_interested')).toBe('not_interested');
  });
});

describe('outcomeForKey and nextLead', () => {
  const outcome = (k: number): DispositionDto => ({
    id: `0199e2e0-0000-7000-8000-00000000000${String(k)}`,
    entityId: null,
    segment: null,
    key: k,
    code: `code_${String(k)}`,
    label: `Outcome ${String(k)}`,
    nextAction: 'retry',
  });

  it('finds the outcome on a key, and none on a key with no outcome', () => {
    const list = [outcome(1), outcome(3)];
    expect(outcomeForKey(list, 3)?.code).toBe('code_3');
    expect(outcomeForKey(list, 2)).toBeUndefined();
  });

  const item = (id: string) => ({ opportunityId: id }) as CallQueueItemDto;

  it('moves to the next lead, starting from the first', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(nextLead(items, undefined)?.opportunityId).toBe('a');
    expect(nextLead(items, 'a')?.opportunityId).toBe('b');
    // From the last lead, back to the first.
    expect(nextLead(items, 'c')?.opportunityId).toBe('a');
    // The only lead of the queue is already open: there is no other.
    expect(nextLead([item('a')], 'a')).toBeUndefined();
    // The open lead left the queue after its call: the first lead is next.
    expect(nextLead(items, 'gone')?.opportunityId).toBe('a');
    expect(nextLead([], undefined)).toBeUndefined();
  });
});

describe('defaultCallbackLocal', () => {
  it('starts at 10:00 India time the next day', () => {
    expect(defaultCallbackLocal(new Date('2026-10-05T11:00:00+05:30'))).toBe('2026-10-06T10:00');
    // 23:30 IST on the 5th is still the 5th in India: the 6th at 10:00.
    expect(defaultCallbackLocal(new Date('2026-10-05T18:00:00Z'))).toBe('2026-10-06T10:00');
    expect(defaultCallbackLocal(new Date('2026-10-31T20:00:00+05:30'))).toBe('2026-11-01T10:00');
  });
});
