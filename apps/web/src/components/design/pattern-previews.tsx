'use client';

import {
  BoardCard,
  BoardColumn,
  Button,
  DateInput,
  Field,
  formatDmy,
  toast,
  useScrolls,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatCount } from '../../screens/format';
import type { DesignCopy } from './component-gallery';

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' });

/** The day of the week of a calendar date, `YYYY-MM-DD`. */
function weekday(iso: string): string {
  return WEEKDAY.format(new Date(`${iso}T00:00:00Z`));
}

/**
 * The date field's whole behaviour (DESIGN.md §6, §9): the dashes go in while typing, a real
 * date is read back with its weekday, and a complete date that does not exist is marked wrong
 * with a sentence, not only a red outline.
 */
export function DateInputPreview({ id, copy }: { id: string; copy: DesignCopy }) {
  const [typed, setTyped] = useState<{ iso: string | undefined; text: string }>({
    iso: undefined,
    text: '',
  });
  const complete = typed.text.length === 10;
  const error = complete && typed.iso === undefined ? copy.dateNotReal : undefined;
  const helper =
    typed.iso === undefined
      ? copy.dateHint
      : copy.dateReads
          .replace('{date}', formatDmy(typed.iso))
          .replace('{weekday}', weekday(typed.iso));
  return (
    <Field id={id} label={copy.dateLabel} helper={helper} error={error}>
      <DateInput
        name="visit"
        onValueChange={(iso, text) => {
          setTyped({ iso, text });
        }}
      />
    </Field>
  );
}

/**
 * A toast with an action (DESIGN.md §6): four seconds, "Undo" puts the change back and says so.
 * On a screen the action runs the command that reverses the change.
 */
export function UndoToastButton({ copy }: { copy: DesignCopy }) {
  return (
    <Button
      variant="secondary"
      onClick={() => {
        toast.success(copy.undoToastBody, {
          action: {
            label: copy.undo,
            onClick: () => {
              toast(copy.undoneToastBody);
            },
          },
        });
      }}
    >
      {copy.showUndoToast}
    </Button>
  );
}

/** Who and what the preview card shows: the print preview's made-up customer, never a real one. */
export interface BoardPreviewCard {
  customerName: string;
  village: string;
  ownerName: string;
}

/**
 * The kanban column and card of the leads board (DESIGN.md §6), as the board draws them: a stage
 * with a card, with its colour bar, count, age, owner and SLA dot, and an empty stage.
 */
export function BoardPreview({ copy, card }: { copy: DesignCopy; card: BoardPreviewCard }) {
  const t = useTranslations('leads.board');
  const [boardBox, boardScrolls] = useScrolls<HTMLDivElement>();
  const days = 2;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-text-muted text-sm font-semibold">{copy.board}</h3>
      <div
        ref={boardBox}
        role="region"
        aria-label={copy.board}
        tabIndex={boardScrolls ? 0 : undefined}
        className="focus-visible:outline-focus flex items-start gap-3 overflow-x-auto rounded-md pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 max-md:flex-col max-md:overflow-visible"
      >
        <BoardColumn
          title={copy.stage['stage-new']}
          tone="new"
          count={t('count', { count: 1, shown: formatCount(1) })}
          emptyLabel={t('emptyColumn')}
          headingLevel="h4"
        >
          <BoardCard
            title={card.customerName}
            subtitle={card.village}
            age={t('age.open', { count: days, shown: formatCount(days) })}
            owner={t('owner', { name: card.ownerName })}
            ownerName={card.ownerName}
            sla={{ tone: 'warn', label: t('sla.warn') }}
          />
        </BoardColumn>
        <BoardColumn
          title={copy.stage['stage-contacted']}
          tone="contacted"
          count={t('count', { count: 0, shown: formatCount(0) })}
          emptyLabel={t('emptyColumn')}
          headingLevel="h4"
        />
      </div>
    </div>
  );
}
