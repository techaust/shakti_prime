import type { ImportJobDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import type { ActionResult } from '../../actions/result';
import { checkProgress } from './progress-check';

function job(state: ImportJobDto['state'], committedRows: number): ImportJobDto {
  return { id: 'job', entityId: 1, state, committedRows } as ImportJobDto;
}

const answer = (result: ActionResult<ImportJobDto>) => () => Promise.resolve(result);

describe('checkProgress', () => {
  it('carries on while the job is still being added', async () => {
    const moving = job('committing', 500);
    expect(await checkProgress(answer({ ok: true, data: moving }))).toEqual({
      kind: 'moving',
      job: moving,
    });
  });

  it('stops once the job has moved on', async () => {
    for (const state of ['committed', 'failed', 'rolled_back'] as const) {
      const done = job(state, 500);
      expect(await checkProgress(answer({ ok: true, data: done }))).toEqual({
        kind: 'finished',
        job: done,
      });
    }
  });

  it('stops with the sentence and reference of a failed answer', async () => {
    expect(await checkProgress(answer({ ok: false, error: 'forbidden' }))).toEqual({
      kind: 'failed',
      error: 'forbidden',
      reference: undefined,
    });
    expect(
      await checkProgress(answer({ ok: false, error: 'internal', reference: 'R-1234' })),
    ).toEqual({ kind: 'failed', error: 'internal', reference: 'R-1234' });
  });

  it('stops with the internal sentence when the answer never arrives', async () => {
    const lost = () => Promise.reject(new Error('the connection dropped'));
    expect(await checkProgress(lost)).toEqual({
      kind: 'failed',
      error: 'internal',
      reference: undefined,
    });
  });
});
