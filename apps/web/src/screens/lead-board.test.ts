import type { BoardLeadDto, LeadBoardDto, PipelineStageDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  appendStagePage,
  applyChange,
  boardChoice,
  boardColumns,
  boardHref,
  boardShowFrom,
  cardActions,
  daysSince,
  moveDecision,
  stageCursor,
  stageTone,
  statesFor,
} from './lead-board';

const id = (n: number) => `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const NEW: PipelineStageDto = { id: id(1), key: 'new', name: 'New', kind: 'open' };
const SITE_VISIT: PipelineStageDto = {
  id: id(3),
  key: 'site_visit',
  name: 'Site visit',
  kind: 'open',
};
const WON: PipelineStageDto = { id: id(5), key: 'won', name: 'Won', kind: 'won' };
const LOST: PipelineStageDto = { id: id(6), key: 'lost', name: 'Lost', kind: 'lost' };
const STAGES: PipelineStageDto[] = [
  NEW,
  { id: id(2), key: 'contacted', name: 'Contacted', kind: 'open' },
  SITE_VISIT,
  WON,
  LOST,
];

function card(n: number, stage: number, state: BoardLeadDto['state'] = 'open'): BoardLeadDto {
  return {
    id: id(100 + n),
    entityId: 1,
    stageId: id(stage),
    state,
    accountId: id(500 + n),
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
    more: [],
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
    expect(moveDecision(lead, NEW)).toBe('none');
  });
  it('moves to another open stage', () => {
    expect(moveDecision(lead, SITE_VISIT)).toBe('move');
  });
  it('asks to win or lose on a closing column, never moves there', () => {
    expect(moveDecision(lead, WON)).toBe('win');
    expect(moveDecision(lead, LOST)).toBe('lose');
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

describe('a column’s Load more', () => {
  const [a, b, c, d] = [card(4, 1), card(3, 1), card(2, 1), card(1, 1)] as const;
  const other = card(5, 2);
  const board: LeadBoardDto = {
    ...boardOf(
      [other, a, b],
      [
        { stageId: id(1), count: 4 },
        { stageId: id(2), count: 1 },
      ],
    ),
    perStage: 2,
    more: [{ stageId: id(1), cursor: 'after-b' }],
  };

  it('knows which stages continue, and from where', () => {
    expect(stageCursor(board, id(1))).toBe('after-b');
    expect(stageCursor(board, id(2))).toBeUndefined();
  });

  it('puts the next page after the stage’s cards and moves its cursor on', () => {
    const after = appendStagePage(board, { stageId: id(1), items: [c], nextCursor: 'after-c' });
    expect(boardColumns(STAGES, after, ['open'])[0]?.cards.map((l) => l.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
    expect(after.more).toEqual([{ stageId: id(1), cursor: 'after-c' }]);
    // The counts stay: they were the whole stage all along.
    expect(after.counts).toBe(board.counts);
  });

  it('forgets the cursor after the last page, and never shows a card twice', () => {
    const after = appendStagePage(board, { stageId: id(1), items: [b, d], nextCursor: null });
    expect(after.items.map((l) => l.id)).toEqual([other.id, a.id, b.id, d.id]);
    expect(stageCursor(after, id(1))).toBeUndefined();
  });

  it('keeps the other stages’ cursors, and keeps a moved card’s place', () => {
    const two = { ...board, more: [...board.more, { stageId: id(2), cursor: 'after-e' }] };
    const after = appendStagePage(two, { stageId: id(1), items: [], nextCursor: null });
    expect(after.more).toEqual([{ stageId: id(2), cursor: 'after-e' }]);
    const moved = applyChange(
      two,
      {
        id: a.id,
        entityId: 1,
        pipelineId: id(50),
        stageId: id(2),
        state: 'open',
        stateChangedAt: a.stateChangedAt,
        ownerId: a.ownerId,
        teamId: null,
        lockedUntil: null,
        updatedAt: '2026-09-28T04:30:00.000Z',
      },
      ['open'],
    );
    expect(moved.more).toEqual(two.more);
  });
});

describe('stage colours and age', () => {
  it('uses the stage token by key, and the kind’s token for a stage added later', () => {
    expect(stageTone({ key: 'qualified', kind: 'open' })).toBe('qualified');
    expect(stageTone({ key: 'site_visit', kind: 'open' })).toBe('new');
    expect(stageTone({ key: 'order_placed', kind: 'won' })).toBe('won');
  });

  it('counts whole days, never below zero', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    expect(daysSince('2026-09-28T09:00:00Z', now)).toBe(0);
    expect(daysSince('2026-09-26T10:00:00Z', now)).toBe(2);
    expect(daysSince('2026-09-29T10:00:00Z', now)).toBe(0);
  });
});

describe('boardChoice', () => {
  const pipeline = (key: string, entityId: number | null) => ({
    id: id(key.length),
    key,
    name: key,
    segment: 'farmer_pumps' as const,
    entityId,
    stages: STAGES,
  });
  const pipelines = [pipeline('shared', null), pipeline('mine', 2), pipeline('theirs', 3)];

  it('takes the company and pipeline from the address when the caller may use them', () => {
    const choice = boardChoice({
      pipelines,
      entityIds: [1, 2],
      company: '2',
      pipeline: 'mine',
      show: 'lost',
    });
    expect(choice).toMatchObject({ entityId: 2, show: 'lost' });
    expect(choice.pipeline?.key).toBe('mine');
    expect(choice.pipelines.map((p) => p.key)).toEqual(['shared', 'mine']);
  });

  it('falls back to the first company and pipeline for anything else', () => {
    const choice = boardChoice({ pipelines, entityIds: [1, 2], company: '3', pipeline: 'theirs' });
    expect(choice.entityId).toBe(1);
    expect(choice.pipeline?.key).toBe('shared');
    expect(choice.show).toBe('open');
    expect(boardChoice({ pipelines: [], entityIds: [1] }).pipeline).toBeUndefined();
  });

  it('writes the address back, leaving the default filter out', () => {
    expect(boardHref({ entityId: 2, pipelineKey: 'mine', show: 'open' })).toBe(
      '/leads/board?company=2&pipeline=mine',
    );
    expect(boardHref({ entityId: undefined, pipelineKey: undefined, show: 'all' })).toBe(
      '/leads/board?show=all',
    );
  });
});
