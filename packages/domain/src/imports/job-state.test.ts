import { ImportJobStateSchema } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { assertImportJobMove, canMoveImportJob, IMPORT_JOB_TRANSITIONS } from './job-state';
import { importRowKey, rollbackChunks } from './row-key';

describe('import job states', () => {
  it('lists every state, and nothing leaves a rolled-back job', () => {
    expect(Object.keys(IMPORT_JOB_TRANSITIONS).sort()).toEqual(
      [...ImportJobStateSchema.options].sort(),
    );
    expect(IMPORT_JOB_TRANSITIONS.rolled_back).toEqual([]);
  });

  it.each([
    ['uploaded', 'mapped'],
    ['mapped', 'previewed'],
    ['previewed', 'mapped'],
    ['previewed', 'committing'],
    ['committing', 'committed'],
    ['committing', 'failed'],
    ['committed', 'rolled_back'],
    ['failed', 'rolled_back'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canMoveImportJob(from, to)).toBe(true);
  });

  it.each([
    ['uploaded', 'previewed'],
    ['uploaded', 'committing'],
    ['mapped', 'committing'],
    ['committing', 'mapped'],
    ['committed', 'committing'],
    ['failed', 'committing'],
    ['rolled_back', 'committing'],
    ['uploaded', 'rolled_back'],
  ] as const)('refuses %s → %s with a reason', (from, to) => {
    let error: unknown;
    try {
      assertImportJobMove(from, to);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: 'conflict', details: { reason: 'import_job_state' } });
  });
});

describe('row keys and rollback order', () => {
  it('gives one row of one job the same UUID every time, and other rows others', () => {
    const job = '01990000-0000-7000-8000-000000000001';
    const key = importRowKey(job, 7);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(importRowKey(job, 7)).toBe(key);
    expect(importRowKey(job, 8)).not.toBe(key);
    expect(importRowKey('01990000-0000-7000-8000-000000000002', 7)).not.toBe(key);
  });

  it('undoes the newest rows first, in chunks', () => {
    expect(rollbackChunks([3, 1, 5, 2, 4], 2)).toEqual([[5, 4], [3, 2], [1]]);
    expect(rollbackChunks([], 500)).toEqual([]);
  });
});
