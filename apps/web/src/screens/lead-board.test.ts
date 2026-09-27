import type { BoardLeadDto, LeadBoardDto, PipelineStageDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyChange,
  boardColumns,
  boardShowFrom,
  cardActions,
  daysSince,
  moveDecision,
  stageBarClass,
  statesFor,
} from './lead-board';

const id = (n: number) => `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const STAGES: PipelineStageDto[] = [
  { id: id(1), key: 'new', name: 'New', kind: 'open' },
  { id: id(2), key: 'contacted', name: 'Contacted', kind: 'open' },
  { id: id(3), key: 'site_visit', name: 'Site visit', kind: 'open' },
  { id: id(5), key: 'won', name: 'Won', kind: 'won' },
  { id: id(6), key: 'lost', name: 'Lost', kind: 'lost' },
];

function card(n: number, stage: number, state: BoardLeadDto['state'] = 'open'): BoardLeadDto {
  return {
    id: id(100 + n),
    entityId: 1,
    stageId: id(stage),
    state,
    customerName: `Customer ${String(n)}`,
    village: null,
    ownerId: id(900),
    ownerName: 'Priya',
    stateChangedAt: '2026-09-20T04:30:00.000Z',
    sla: null,
    updatedAt: `2026-09-2${String(n)}T04:30:00.000Z`,
  };
}

function boardOf(items: BoardLeadDto[], counts?: LeadBoardDto['counts']): LeadBoardDto {
  const tally = new Map<string, number>();
  for (const l of items) tally.set(l.stageId, (tally.get(l.stageId) ?? 0) + 1);
  return {
    pipelineId: id(50),
    perStage: 100,
    items,
    counts: counts ?? [...tally].map(([stageId, count]) => ({ stageId, count })),
  };
}

describe('the board filter', () => {
  it('reads the address and falls back to open leads', () => {
    expect(boardShowFrom('lost')).toBe('lost');
    expect(boardShowFrom('everything')).toBe('open');
    expect(boardShowFrom(undefined)).toBe('open');
    expect(statesFor('open')).toEqual(['open']);
    expect(statesFor('all')).toEqual(['open', 'nurture', 'won', 'lost']);
  });
});

describe('boardColumns', () => {
  it('shows every open stage in order, and the closing stages only when asked', () => {
    const board = boardOf([card(3, 1), card(2, 1), card(1, 2)]);
    const open = boardColumns(STAGES, board, ['open']);
    expect(open.map((c) => c.stage.key)).toEqual(['new', 'contacted', 'site_visit']);
    expect(open.map((c) => c.cards.map((l) => l.customerName))).toEqual([
      ['Customer 3', 'Customer 2'],
      ['Customer 1'],
      [],
    ]);
    expect(open.map((c) => c.count)).toEqual([2, 1, 0]);
    expect(boardColumns(STAGES, boardOf([]), ['lost']).map((c) => c.stage.key)).toEqual([
      'new',
      'contacted',
      'site_visit',
      'lost',
    ]);
    expect(boardColumns(STAGES, boardOf([]), statesFor('all'))).toHaveLength(5);
  });

  it('counts past the cards shown, and shows a closing stage that holds a lead', () => {
    const board = boardOf(
      [card(1, 1), card(2, 6, 'nurture')],
      [
        { stageId: id(1), count: 140 },
        { stageId: id(6), count: 1 },
      ],
    );
    const columns = boardColumns(STAGES, board, ['open', 'nurture']);
    expect(columns.map((c) => [c.stage.key, c.count])).toEqual([
      ['new', 140],
      ['contacted', 0],
      ['site_visit', 0],
      ['lost', 1],
    ]);
  });
});

describe('moveDecision', () => {
  const lead = card(1, 1);
  it('does nothing on the lead’s own column', () => {
    expect(moveDecision(lead, STAGES[0] as PipelineStageDto)).toBe('none');
  });
  it('moves to another open stage', () => {
    expect(moveDecision(lead, STAGES[2] as PipelineStageDto)).toBe('move');
  });
  it('asks to win or lose on a closing column, never moves there', () => {
    expect(moveDecision(lead, STAGES[3] as PipelineStageDto)).toBe('win');
    expect(moveDecision(lead, STAGES[4] as PipelineStageDto)).toBe('lose');
  });
});

describe('cardActions', () => {
  const all = { write: true, assign: true };
  it('offers an open lead every move, win included', () => {
    expect(cardActions('open', all)).toEqual({
      move: true,
      assign: true,
      nurture: true,
      reopen: false,
      win: true,
      lose: true,
    });
  });
  it('offers a parked lead reopen and lose, a lost one reopen, a won one nothing', () => {
    expect(cardActions('nurture', all)).toMatchObject({ reopen: true, lose: true, move: false });
    expect(cardActions('lost', all)).toMatchObject({ reopen: true, lose: false, win: false });
    expect(Object.values(cardActions('won', all)).some(Boolean)).toBe(false);
  });
  it('follows the caller’s permissions', () => {
    expect(cardActions('open', { write: true, assign: false }).assign).toBe(false);
    expect(Object.values(cardActions('open', { write: false, assign: true })).some(Boolean)).toBe(
      false,
    );
  });
});

describe('applyChange', () => {
  const a = card(1, 1);
  const b = card(2, 1);
  const board = boardOf([b, a]);
  const moved = {
    id: a.id,
    entityId: 1,
    pipelineId: id(50),
    stageId: id(2),
    state: 'open' as const,
    stateChangedAt: a.stateChangedAt,
    ownerId: a.ownerId,
    teamId: null,
    lockedUntil: null,
    updatedAt: '2026-09-28T04:30:00.000Z',
  };

  it('moves the card to its new column, first, and moves the count with it', () => {
    const after = applyChange(board, moved, ['open']);
    expect(after.items.map((l) => [l.id, l.stageId])).toEqual([
      [a.id, id(2)],
      [b.id, id(1)],
    ]);
    const columns = boardColumns(STAGES, after, ['open']);
    expect(columns.map((c) => c.count)).toEqual([1, 1, 0]);
  });

  it('takes the new owner’s name, and keeps the name when the owner stays', () => {
    const assigned = applyChange(
      board,
      { ...moved, stageId: id(1), ownerId: id(901) },
      ['open'],
      'Suresh',
    );
    expect(assigned.items[0]).toMatchObject({ ownerId: id(901), ownerName: 'Suresh' });
    expect(applyChange(board, moved, ['open']).items[0]?.ownerName).toBe('Priya');
  });

  it('drops a lead whose new status the filter does not show', () => {
    const lost = applyChange(board, { ...moved, stageId: id(6), state: 'lost' }, ['open']);
    expect(lost.items.map((l) => l.id)).toEqual([b.id]);
    expect(boardColumns(STAGES, lost, ['open']).map((c) => c.count)).toEqual([1, 0, 0]);
  });

  it('leaves the board alone for a lead it does not show', () => {
    expect(applyChange(board, { ...moved, id: id(999) }, ['open'])).toBe(board);
  });
});

describe('stage colours and age', () => {
  it('uses the stage token by key, and the kind’s token for a stage added later', () => {
    expect(stageBarClass({ key: 'qualified', kind: 'open' })).toBe('bg-stage-qualified');
    expect(stageBarClass({ key: 'site_visit', kind: 'open' })).toBe('bg-stage-new');
    expect(stageBarClass({ key: 'order_placed', kind: 'won' })).toBe('bg-stage-won');
  });

  it('counts whole days, never below zero', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    expect(daysSince('2026-09-28T09:00:00Z', now)).toBe(0);
    expect(daysSince('2026-09-26T10:00:00Z', now)).toBe(2);
    expect(daysSince('2026-09-29T10:00:00Z', now)).toBe(0);
  });
});
