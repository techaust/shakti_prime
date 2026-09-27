// The leads board's arithmetic (DESIGN.md §6, Kanban board): which columns show, which cards sit
// in each, what a drop means and how a finished change moves a card. No command runs here; the
// screen calls the opportunity actions and the database decides.

import type {
  BoardLeadDto,
  LeadBoardDto,
  OpportunityDto,
  OpportunityState,
  PipelineStageDto,
} from '@shakti/contracts';

/** What the board's filter offers: open leads by default, or one of the other statuses, or all. */
export const BOARD_SHOW = ['open', 'nurture', 'won', 'lost', 'all'] as const;
export type BoardShow = (typeof BOARD_SHOW)[number];

/** The filter named in the address, or open leads when it names nothing the board knows. */
export function boardShowFrom(value: string | undefined): BoardShow {
  return BOARD_SHOW.find((s) => s === value) ?? 'open';
}

/** The statuses a filter asks the board for. */
export function statesFor(show: BoardShow): OpportunityState[] {
  return show === 'all' ? ['open', 'nurture', 'won', 'lost'] : [show];
}

/**
 * The colour bar of a stage (DESIGN.md §2.4): the six stage tokens by the stage's key; a stage an
 * Executive added later takes the colour of its kind. Whole class names, so the style build sees them.
 */
const STAGE_BAR: Record<string, string> = {
  new: 'bg-stage-new',
  contacted: 'bg-stage-contacted',
  qualified: 'bg-stage-qualified',
  quoted: 'bg-stage-quoted',
  won: 'bg-stage-won',
  lost: 'bg-stage-lost',
};

export function stageBarClass(stage: Pick<PipelineStageDto, 'key' | 'kind'>): string {
  return STAGE_BAR[stage.key] ?? STAGE_BAR[stage.kind === 'open' ? 'new' : stage.kind] ?? '';
}

/** The SLA dot's colour by its status (DESIGN.md §2.4). */
export const SLA_DOT: Record<NonNullable<BoardLeadDto['sla']>, string> = {
  ok: 'bg-sla-ok',
  warn: 'bg-sla-warn',
  breach: 'bg-sla-breach',
};

export interface BoardColumn {
  stage: PipelineStageDto;
  /** Every lead in the stage under the filter, including those past the cards shown. */
  count: number;
  cards: BoardLeadDto[];
}

/**
 * The columns in stage order: every open stage, the won and lost stages when the filter asks for
 * those statuses, and any other stage that holds a lead. Cards keep the board's order (newest
 * change first).
 */
export function boardColumns(
  stages: readonly PipelineStageDto[],
  board: Pick<LeadBoardDto, 'counts' | 'items'>,
  states: readonly OpportunityState[],
): BoardColumn[] {
  const counts = new Map(board.counts.map((c) => [c.stageId, c.count]));
  return stages
    .filter(
      (stage) =>
        stage.kind === 'open' ||
        states.includes(stage.kind) ||
        (counts.get(stage.id) ?? 0) > 0 ||
        board.items.some((l) => l.stageId === stage.id),
    )
    .map((stage) => {
      const cards = board.items.filter((l) => l.stageId === stage.id);
      return { stage, count: Math.max(counts.get(stage.id) ?? 0, cards.length), cards };
    });
}

/** What dropping a card on a column asks for. */
export type MoveDecision = 'none' | 'move' | 'win' | 'lose';

/**
 * A drop on the lead's own column does nothing; on the won or lost column it asks to close the
 * lead that way (a stage move never closes one); on another open stage it moves the lead. Whether
 * the lead may go there is the command's to decide, and its refusal is shown as the sentence.
 */
export function moveDecision(
  lead: Pick<BoardLeadDto, 'stageId'>,
  target: Pick<PipelineStageDto, 'id' | 'kind'>,
): MoveDecision {
  if (lead.stageId === target.id) return 'none';
  if (target.kind === 'won') return 'win';
  if (target.kind === 'lost') return 'lose';
  return 'move';
}

/** The actions a card's menu offers for the lead's status and the caller's permissions. */
export interface CardActions {
  move: boolean;
  assign: boolean;
  nurture: boolean;
  reopen: boolean;
  win: boolean;
  lose: boolean;
}

export function cardActions(
  state: OpportunityState,
  can: { write: boolean; assign: boolean },
): CardActions {
  const open = state === 'open';
  return {
    move: can.write && open,
    assign: can.assign && can.write && open,
    nurture: can.write && open,
    reopen: can.write && (state === 'nurture' || state === 'lost'),
    // Offered on every open lead; until quotes and orders exist it answers why it cannot be won.
    win: can.write && open,
    lose: can.write && (open || state === 'nurture'),
  };
}

/**
 * The board after a command changed one lead: the card takes its new stage, status and owner and
 * goes first (it is now the newest change); the counts follow it. A lead whose new status the
 * filter does not show leaves the board.
 */
export function applyChange(
  board: LeadBoardDto,
  changed: OpportunityDto,
  states: readonly OpportunityState[],
  ownerName?: string,
): LeadBoardDto {
  const before = board.items.find((l) => l.id === changed.id);
  if (before === undefined) return board;
  const after: BoardLeadDto = {
    ...before,
    stageId: changed.stageId,
    state: changed.state,
    ownerId: changed.ownerId,
    ownerName: changed.ownerId === before.ownerId ? before.ownerName : (ownerName ?? null),
    stateChangedAt: changed.stateChangedAt,
    updatedAt: changed.updatedAt,
  };
  const stays = states.includes(after.state);
  const counts = new Map(board.counts.map((c) => [c.stageId, c.count]));
  counts.set(before.stageId, Math.max((counts.get(before.stageId) ?? 1) - 1, 0));
  if (stays) counts.set(after.stageId, (counts.get(after.stageId) ?? 0) + 1);
  const others = board.items.filter((l) => l.id !== changed.id);
  return {
    ...board,
    counts: [...counts].map(([stageId, count]) => ({ stageId, count })),
    items: stays ? [after, ...others] : others,
  };
}

const DAY_MS = 86_400_000;

/** Whole days from `since` to `now`; never negative, so a clock a little ahead reads 0. */
export function daysSince(since: string, now: Date): number {
  return Math.max(Math.floor((now.getTime() - Date.parse(since)) / DAY_MS), 0);
}
