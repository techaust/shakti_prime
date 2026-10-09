'use client';

import type {
  CallLeadDto,
  ConvertingBoardDto,
  ConvertingLeadDto,
  ConvertingPanel,
  LeadSearchHitDto,
} from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCallLead } from '../../actions/calling';
import { loadConvertingBoard } from '../../actions/converting';
import { isTypingTarget, outcomeForKey } from '../../screens/calling';
import { convertingShortcut, leadKey, movedIndex, groupByStage } from '../../screens/converting';
import { Search } from '../calling/calling-parts';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { KeysHelp } from './keys-help';
import { NextActions, StageBoard } from './lead-board';
import { LeadWorkspace, NoLead } from './lead-workspace';
import { useCallLogging } from './use-call-logging';

/**
 * Runs `focus` on the first element matching `selector` inside `root` as soon as one exists: a
 * panel that loads its form after it opens (sizing, the quote) has none at first. Gives up after
 * two seconds.
 */
function focusSoon(root: HTMLElement | null, selector: string): void {
  let tries = 0;
  const attempt = () => {
    const target = root?.querySelector<HTMLElement>(selector);
    if (target !== null && target !== undefined) target.focus();
    else if ((tries += 1) < 20) window.setTimeout(attempt, 100);
  };
  window.requestAnimationFrame(attempt);
}

/**
 * The Lead Converter workspace (PRD TEL-03, docs/08-design-system.md §6, Caller workspace): the converter's leads by
 * stage and the rules' list of what to do next on one side, the open lead on the other with its
 * calls, sizing, quote and any held order, worked from the keyboard (`convertingShortcut`). Every
 * change a person makes goes through the command of its own screen (`calls.log`, `crm.sizing.record`,
 * `sales.quote.create`); the board and the list are then read again.
 */
export function ConvertingScreen({
  initialBoard,
  ownerId,
  canWrite,
}: {
  initialBoard: ConvertingBoardDto;
  /** A person of the caller's team whose leads a team lead is viewing; absent for the caller's own. */
  ownerId?: string;
  /** The caller holds `crm.lead.write`, so the sizing form is offered. */
  canWrite: boolean;
}) {
  const t = useTranslations('converting');
  const [board, setBoard] = useState(initialBoard);
  const [lead, setLead] = useState<CallLeadDto | null>(null);
  const [panel, setPanel] = useState<ConvertingPanel>('calls');
  const [help, setHelp] = useState(false);
  // Counts the leads opened; the heading takes the keyboard once it is on the page.
  const [opened, setOpened] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const boardQuery = useQuery<ConvertingBoardDto>();
  const leadQuery = useQuery<CallLeadDto>();

  const refreshBoard = useCallback(() => {
    boardQuery.load(() => loadConvertingBoard(ownerId === undefined ? {} : { ownerId }), setBoard);
  }, [boardQuery, ownerId]);

  const openLead = useCallback(
    (ref: { entityId: number; opportunityId: string }, to: ConvertingPanel = 'calls') => {
      // Only the lead's reference: the input is strict, and a card or a lead carries more.
      const input = { entityId: ref.entityId, opportunityId: ref.opportunityId };
      leadQuery.load(
        () => loadCallLead(input),
        (loaded) => {
          setLead(loaded);
          setPanel(to);
          setOpened((n) => n + 1);
        },
      );
    },
    [leadQuery],
  );

  // The workspace takes the keyboard back once a lead is open, so the next key is the workspace's.
  useEffect(() => {
    if (opened > 0) headingRef.current?.focus();
  }, [opened]);

  // A call saved, a sizing saved or a quote made: the lead and the board are read again, and the
  // list changes with them.
  const changed = useCallback(() => {
    refreshBoard();
    if (lead !== null) {
      leadQuery.load(
        () => loadCallLead({ entityId: lead.entityId, opportunityId: lead.opportunityId }),
        setLead,
      );
    }
  }, [refreshBoard, leadQuery, lead]);

  const calling = useCallLogging(lead, changed);
  const { pick, showNumber, picked } = calling;

  const facts: ConvertingLeadDto | undefined =
    lead === null ? undefined : board.leads.find((l) => l.opportunityId === lead.opportunityId);

  // The leads in the order the board shows them, for J and K.
  const ordered = groupByStage(board.leads).flatMap((g) => g.leads);

  const moveTo = useCallback(
    (step: 1 | -1) => {
      const focused = document.activeElement;
      let at = ordered.findIndex((l) => buttons.current.get(leadKey(l)) === focused);
      if (at < 0 && lead !== null)
        at = ordered.findIndex((l) => l.opportunityId === lead.opportunityId);
      const to = movedIndex(ordered.length, at, step);
      const target = to === undefined ? undefined : ordered[to];
      if (target === undefined) return;
      const button = buttons.current.get(leadKey(target));
      button?.focus();
      button?.scrollIntoView({ block: 'nearest' });
    },
    [ordered, lead],
  );

  // The workspace's keys, on the whole page while no field or dialog has the keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || picked !== undefined || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      const shortcut = convertingShortcut(event);
      if (shortcut === undefined) return;
      const needsLead =
        shortcut.kind !== 'search' &&
        shortcut.kind !== 'help' &&
        shortcut.kind !== 'move' &&
        shortcut.kind !== 'next';
      if (needsLead && lead === null) return;
      if (shortcut.kind === 'outcome' && panel !== 'calls') return;
      event.preventDefault();
      switch (shortcut.kind) {
        case 'search':
          // The last search is selected, so the next name typed replaces it.
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case 'help':
          setHelp((open) => !open);
          break;
        case 'move':
          moveTo(shortcut.step);
          break;
        case 'next': {
          const first = board.actions[0];
          if (first !== undefined) openLead(first, first.panel);
          break;
        }
        case 'log':
          setPanel('calls');
          focusSoon(panelRef.current, '[aria-keyshortcuts]');
          break;
        case 'callback': {
          const outcome = lead?.dispositions.find((d) => d.nextAction === 'callback');
          setPanel('calls');
          if (outcome !== undefined) pick(outcome);
          break;
        }
        case 'sizing':
          setPanel('sizing');
          focusSoon(panelRef.current, 'form select, form input');
          break;
        case 'quote':
          setPanel('quote');
          focusSoon(panelRef.current, 'select, [role="status"] a');
          break;
        case 'dial':
          setPanel('calls');
          showNumber();
          break;
        case 'outcome': {
          const outcome =
            lead === null ? undefined : outcomeForKey(lead.dispositions, shortcut.key);
          if (outcome !== undefined) pick(outcome);
          break;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picked, lead, panel, board.actions, moveTo, openLead, pick, showNumber]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label={t('keys.what.search')}
          className="border-border bg-surface rounded-lg border p-4"
        >
          <Search
            inputRef={searchRef}
            onOpen={(hit: LeadSearchHitDto) => {
              openLead({ entityId: hit.entityId, opportunityId: hit.id });
            }}
          />
        </section>
        <FailureMessage failure={boardQuery.failure} />
        <NextActions
          actions={board.actions}
          onOpen={(action) => {
            openLead(action, action.panel);
          }}
        />
        <StageBoard
          board={board}
          current={lead?.opportunityId}
          buttons={buttons}
          pending={boardQuery.pending}
          onOpen={(card) => {
            openLead(card);
          }}
          onRefresh={refreshBoard}
        />
        <KeysHelp open={help} onToggle={setHelp} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <FailureMessage failure={leadQuery.failure} />
        {lead === null ? (
          <NoLead />
        ) : (
          <LeadWorkspace
            lead={lead}
            facts={facts}
            panel={panel}
            onPanel={setPanel}
            canWrite={canWrite}
            calling={calling}
            headingRef={headingRef}
            panelRef={panelRef}
            pending={leadQuery.pending}
            onChanged={changed}
          />
        )}
      </div>
    </div>
  );
}
