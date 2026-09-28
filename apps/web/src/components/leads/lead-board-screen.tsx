'use client';

import type {
  BoardLeadDto,
  LeadBoardDto,
  OpportunityDto,
  PipelineStageDto,
} from '@shakti/contracts';
import {
  BoardCard,
  BoardColumn,
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Select,
  StatusBadge,
  toast,
  type StatusTone,
} from '@shakti/ui';
import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { moveOpportunityStage } from '../../actions/crm';
import {
  applyChange,
  BOARD_SHOW,
  boardColumns,
  boardHref,
  cardActions,
  daysSince,
  formatCount,
  moveDecision,
  stageTone,
  statesFor,
  type BoardColumn as StageColumn,
  type BoardShow,
} from '../../screens/lead-board';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';
import { AssignForm, ConfirmForm, LoseForm, MoveForm, NurtureForm } from './board-dialogs';

type DialogKind = 'move' | 'assign' | 'nurture' | 'reopen' | 'win' | 'lose';

const STATE_TONE: Record<BoardLeadDto['state'], StatusTone> = {
  open: 'accent',
  nurture: 'info',
  won: 'success',
  lost: 'neutral',
};

/**
 * The leads board (DESIGN.md §6): one column per stage in stage order with its colour bar and
 * count, cards with the customer, village, age, owner and SLA dot. A card moves by dragging it to
 * another column or through its menu, which also parks, reopens, closes and assigns the lead. Every
 * change goes through the opportunity actions; a refusal shows the sentence the command answers.
 * Below `md` one column shows at a time, picked with the stage switcher.
 */
export function LeadBoardScreen({
  initial,
  stages,
  pipelines,
  pipelineKey,
  companies,
  entityId,
  show,
  can,
}: {
  initial: LeadBoardDto;
  stages: PipelineStageDto[];
  pipelines: { key: string; name: string }[];
  pipelineKey: string;
  /** The companies to choose from; the picker shows only when there is more than one. */
  companies: { id: number; name: string }[];
  entityId: number | undefined;
  show: BoardShow;
  can: { write: boolean; assign: boolean };
}) {
  const t = useTranslations('leads.board');
  const common = useTranslations('common');
  const router = useRouter();
  // One clock for every card's age, read when the board opens.
  const [now] = useState(() => new Date());
  const states = statesFor(show);
  const [board, setBoard] = useState(initial);
  const [dialog, setDialog] = useState<{ kind: DialogKind; lead: BoardLeadDto } | undefined>();
  const [dragging, setDragging] = useState<string | undefined>();
  const [over, setOver] = useState<string | undefined>();
  const [showDropFailure, setShowDropFailure] = useState(false);
  const move = useCommand(moveOpportunityStage);
  const columns = boardColumns(stages, board, states);
  const [phoneStage, setPhoneStage] = useState(() => columns[0]?.stage.id);
  const stageNames = new Map(stages.map((s) => [s.id, s.name]));

  function go(change: { entityId?: number; pipelineKey?: string; show?: BoardShow }) {
    router.push(
      boardHref({
        entityId: change.entityId ?? entityId,
        pipelineKey: change.pipelineKey ?? pipelineKey,
        show: change.show ?? show,
      }),
    );
  }

  function changed(result: OpportunityDto, ownerName?: string) {
    setBoard((b) => applyChange(b, result, states, ownerName));
  }

  function open(kind: DialogKind, lead: BoardLeadDto) {
    setShowDropFailure(false);
    setDialog({ kind, lead });
  }

  function close() {
    setDialog(undefined);
  }

  function drop(stage: PipelineStageDto) {
    const lead = board.items.find((l) => l.id === dragging);
    setDragging(undefined);
    setOver(undefined);
    if (lead === undefined || move.pending) return;
    const decision = moveDecision(lead, stage);
    if (decision === 'win' || decision === 'lose') {
      open(decision, lead);
      return;
    }
    if (decision === 'none') return;
    setShowDropFailure(true);
    move.run({ entityId: lead.entityId, opportunityId: lead.id, stageId: stage.id }, (result) => {
      changed(result);
      toast.success(t('moveDialog.done', { name: lead.customerName, stage: stage.name }));
    });
  }

  function dropZone(
    stage: PipelineStageDto,
  ): Pick<ComponentProps<'section'>, 'onDragOver' | 'onDragLeave' | 'onDrop'> {
    if (!can.write) return {};
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (dragging === undefined) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(stage.id);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        drop(stage);
      },
    };
  }

  const done = (message: string) => (result: OpportunityDto, ownerName?: string) => {
    changed(result, ownerName);
    close();
    toast.success(message);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        role="group"
        aria-label={t('filters')}
        className="grid gap-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-end"
      >
        {companies.length > 1 ? (
          <Field id="board-company" label={t('company')} className="md:w-56">
            <Select
              value={entityId === undefined ? '' : String(entityId)}
              onChange={(e) => {
                go({ entityId: Number(e.target.value) });
              }}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="board-pipeline" label={t('pipeline')} className="md:w-56">
          <Select
            value={pipelineKey}
            onChange={(e) => {
              go({ pipelineKey: e.target.value });
            }}
          >
            {pipelines.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="board-show" label={t('show')} className="md:w-56">
          <Select
            value={show}
            onChange={(e) => {
              go({ show: e.target.value as BoardShow });
            }}
          >
            {BOARD_SHOW.map((s) => (
              <option key={s} value={s}>
                {t(`showOption.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="board-stage" label={t('stage')} className="md:hidden">
          <Select
            value={phoneStage ?? ''}
            onChange={(e) => {
              setPhoneStage(e.target.value);
            }}
          >
            {columns.map((c) => (
              <option key={c.stage.id} value={c.stage.id}>
                {t('stageOption', {
                  stage: c.stage.name,
                  count: c.count,
                  shown: formatCount(c.count),
                })}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {showDropFailure ? <FailureMessage failure={move.failure} /> : null}
      <p role="status" className="sr-only">
        {move.pending ? t('moving') : ''}
      </p>

      <div
        className="flex items-start gap-3 overflow-x-auto pb-2 max-md:block max-md:overflow-visible"
        aria-busy={move.pending}
      >
        {columns.map((column) => (
          <Column
            key={column.stage.id}
            column={column}
            perStage={board.perStage}
            hiddenOnPhone={column.stage.id !== phoneStage}
            over={over === column.stage.id}
            dropZone={dropZone(column.stage)}
          >
            {column.cards.map((lead) => (
              <Card
                key={lead.id}
                lead={lead}
                showState={show !== 'open'}
                now={now}
                draggable={can.write && lead.state === 'open' && !move.pending}
                onDragStart={() => {
                  setDragging(lead.id);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setOver(undefined);
                }}
                menu={
                  <CardMenu
                    lead={lead}
                    can={can}
                    label={common('rowActions', { name: lead.customerName })}
                    onOpen={(kind) => {
                      open(kind, lead);
                    }}
                  />
                }
              />
            ))}
          </Column>
        ))}
      </div>

      <Dialog
        open={dialog !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        {dialog === undefined ? null : (
          <DialogContent closeLabel={common('close')}>
            <BoardDialog
              kind={dialog.kind}
              lead={dialog.lead}
              stages={stages}
              onCancel={close}
              onDone={(result, ownerName) => {
                const name = dialog.lead.customerName;
                const message =
                  dialog.kind === 'move'
                    ? t('moveDialog.done', { name, stage: stageNames.get(result.stageId) ?? '' })
                    : dialog.kind === 'assign'
                      ? t('assignDialog.done', { name, person: ownerName ?? '' })
                      : t(`${dialog.kind}Dialog.done`, { name });
                done(message)(result, ownerName);
              }}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function BoardDialog({
  kind,
  lead,
  stages,
  onDone,
  onCancel,
}: {
  kind: DialogKind;
  lead: BoardLeadDto;
  stages: readonly PipelineStageDto[];
  onDone: (result: OpportunityDto, ownerName?: string) => void;
  onCancel: () => void;
}) {
  const props = { lead, onDone, onCancel };
  switch (kind) {
    case 'move':
      return <MoveForm {...props} stages={stages} />;
    case 'assign':
      return <AssignForm {...props} />;
    case 'nurture':
      return <NurtureForm {...props} />;
    case 'lose':
      return <LoseForm {...props} />;
    case 'reopen':
    case 'win':
      return <ConfirmForm {...props} kind={kind} />;
  }
}

/** One stage: its colour bar, name and count, then its cards; a drop target when the caller writes. */
function Column({
  column,
  perStage,
  hiddenOnPhone,
  over,
  dropZone,
  children,
}: {
  column: StageColumn;
  perStage: number;
  hiddenOnPhone: boolean;
  over: boolean;
  dropZone: Pick<ComponentProps<'section'>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  children: ReactNode;
}) {
  const t = useTranslations('leads.board');
  const { stage, count, cards } = column;
  return (
    <BoardColumn
      title={stage.name}
      tone={stageTone(stage)}
      count={t('count', { count, shown: formatCount(count) })}
      note={
        count > cards.length && cards.length >= perStage
          ? t('partial', { count, shown: formatCount(cards.length), total: formatCount(count) })
          : undefined
      }
      emptyLabel={t('emptyColumn')}
      hiddenOnPhone={hiddenOnPhone}
      highlighted={over}
      {...dropZone}
    >
      {cards.length === 0 ? null : children}
    </BoardColumn>
  );
}

/** A lead card: customer, village, age, owner and the SLA dot when a rule covers the lead. */
function Card({
  lead,
  showState,
  now,
  draggable,
  onDragStart,
  onDragEnd,
  menu,
}: {
  lead: BoardLeadDto;
  showState: boolean;
  now: Date;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  menu: ReactNode;
}) {
  const t = useTranslations('leads.board');
  const leads = useTranslations('leads');
  const days = daysSince(lead.stateChangedAt, now);
  const ageKey = lead.state === 'open' ? 'open' : lead.state === 'nurture' ? 'nurture' : 'closed';
  return (
    <BoardCard
      title={lead.customerName}
      subtitle={lead.village ?? t('villageUnknown')}
      menu={menu}
      badge={
        showState ? (
          <StatusBadge tone={STATE_TONE[lead.state]} className="self-start">
            {leads(`state.${lead.state}`)}
          </StatusBadge>
        ) : undefined
      }
      age={t(`age.${ageKey}`, { count: days, shown: formatCount(days) })}
      owner={lead.ownerName === null ? t('noOwner') : t('owner', { name: lead.ownerName })}
      sla={lead.sla === null ? undefined : { tone: lead.sla, label: t(`sla.${lead.sla}`) }}
      dragId={draggable ? lead.id : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    />
  );
}

/** The card's menu: the moves that apply to the lead's status and the caller's permissions. */
function CardMenu({
  lead,
  can,
  label,
  onOpen,
}: {
  lead: BoardLeadDto;
  can: { write: boolean; assign: boolean };
  label: string;
  onOpen: (kind: DialogKind) => void;
}) {
  const t = useTranslations('leads.board');
  const actions = cardActions(lead.state, can);
  if (!Object.values(actions).some(Boolean)) return null;
  const item = (kind: DialogKind, text: string) => (
    <DropdownMenuItem
      onSelect={() => {
        onOpen(kind);
      }}
    >
      {text}
    </DropdownMenuItem>
  );
  return (
    // Not modal, so the dialog it opens takes focus cleanly when the menu closes.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="-mt-1 -mr-1 shrink-0">
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.move ? item('move', t('menuMove')) : null}
        {actions.assign ? item('assign', t('menuAssign')) : null}
        {actions.nurture ? item('nurture', t('menuNurture')) : null}
        {actions.reopen ? item('reopen', t('menuReopen')) : null}
        {actions.win || actions.lose ? <DropdownMenuSeparator /> : null}
        {actions.win ? item('win', t('menuWin')) : null}
        {actions.lose ? item('lose', t('menuLost')) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
