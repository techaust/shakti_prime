'use client';

import type {
  CallLeadDto,
  DispositionDto,
  LeadSearchHitDto,
  LogCallResultDto,
} from '@shakti/contracts';
import { Button, Input } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { searchCallLeads } from '../../actions/calling';
import { SEARCH_MIN_CHARS } from '../../screens/contract-values';
import { formatDateTime, formatPhone } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery, type CommandFailure } from '../screens/use-command';

// The parts the Cold Caller workspace and the Lead Converter workspace share: a titled panel, a
// key hint, the number to dial, the outcome buttons and the sentence a saved call gets.

/** One titled part of the workspace. */
export function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A key the caller can press, as the hints show it. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border-strong bg-surface-2 text-text-muted rounded-sm border px-1.5 font-mono text-xs">
      {children}
    </kbd>
  );
}

/** The lead's number in full, asked for with `D`, or why it cannot be shown now. */
export function DialNumber({
  lead,
  shown,
  failure,
  pending,
  onShow,
}: {
  lead: CallLeadDto;
  shown: string | undefined;
  failure: CommandFailure | undefined;
  pending: boolean;
  onShow: () => void;
}) {
  const t = useTranslations('calling.lead');
  const keys = useTranslations('calling.keys');
  if (lead.phoneLast4 === null) return <p className="text-text-muted">{t('noPhone')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-text-muted">{t('phoneEnding', { last4: lead.phoneLast4 })}</span>
        {lead.consentWithdrawn ? null : (
          <Button size="sm" variant="secondary" pending={pending} onClick={onShow}>
            {t('showNumber')} <Key>{keys('dial')}</Key>
          </Button>
        )}
      </div>
      {shown === undefined ? null : (
        <p className="flex flex-col">
          <span className="text-text-muted text-sm">{t('numberLabel')}</span>
          <span className="text-h2 tabular-nums">{formatPhone(shown)}</span>
        </p>
      )}
      <FailureMessage failure={failure} />
    </div>
  );
}

/** The outcomes on their number keys, which save the call (with a detail when one is needed). */
export function Outcomes({
  lead,
  pending,
  onPick,
}: {
  lead: CallLeadDto;
  pending: boolean;
  onPick: (outcome: DispositionDto) => void;
}) {
  const t = useTranslations('calling');
  const disabled = !lead.canLog || lead.consentWithdrawn;
  return (
    <Panel id="calling-outcomes" title={t('outcomes.title')}>
      {lead.state !== 'open' && lead.state !== 'nurture' ? (
        <p className="text-text-muted">{t('lead.closed')}</p>
      ) : lead.consentWithdrawn ? (
        <p className="text-danger">{t('lead.consentWithdrawn')}</p>
      ) : !lead.canLog ? (
        <p className="text-text-muted">{t('lead.cannotLog')}</p>
      ) : (
        <p className="text-text-muted text-sm">{t('outcomes.hint')}</p>
      )}
      {lead.dispositions.length === 0 ? (
        <p className="text-text-muted">{t('outcomes.none')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {lead.dispositions.map((outcome) => (
            <Button
              key={outcome.id}
              variant="secondary"
              className="justify-start"
              disabled={disabled || pending}
              aria-keyshortcuts={String(outcome.key)}
              onClick={() => {
                onPick(outcome);
              }}
            >
              <Key>{outcome.key}</Key>
              <span className="truncate">{outcome.label}</span>
            </Button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** What a saved call did, in words, for the toast. */
export function savedMessage(
  t: ReturnType<typeof useTranslations<'calling'>>,
  result: LogCallResultDto,
): string {
  const when = result.nextCall === null ? undefined : formatDateTime(result.nextCall.dueAt);
  if (result.attemptsUsedUp && when !== undefined) return t('logged.usedUp', { when });
  switch (result.nextAction) {
    case 'callback':
      return when === undefined ? t('logged.saved') : t('logged.callback', { when });
    case 'retry':
      return when === undefined ? t('logged.saved') : t('logged.nextTry', { when });
    case 'qualified':
      return t('logged.qualified');
    case 'not_interested':
    case 'wrong_number':
      return t('logged.lost');
    case 'nurture':
      return t('logged.nurture');
  }
}

/** The workspace's search (`/`): the caller's leads by name, village or phone. */
export function Search({
  inputRef,
  onOpen,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onOpen: (hit: LeadSearchHitDto) => void;
}) {
  const t = useTranslations('calling.search');
  const keys = useTranslations('calling.keys');
  const id = useId();
  const [hits, setHits] = useState<LeadSearchHitDto[] | undefined>();
  const search = useQuery<LeadSearchHitDto[]>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = inputRef.current?.value.trim() ?? '';
    if (q.length < SEARCH_MIN_CHARS) return;
    search.load(() => searchCallLeads({ q }), setHits);
  }

  return (
    <form role="search" onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-text-muted text-sm">
        {t('label')} <Key>{keys('search')}</Key>
      </label>
      <Input
        id={id}
        ref={inputRef}
        type="search"
        autoComplete="off"
        aria-describedby={`${id}-helper`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
      <p id={`${id}-helper`} className="text-text-muted text-xs">
        {t('helper')}
      </p>
      <FailureMessage failure={search.failure} />
      {hits === undefined ? null : hits.length === 0 ? (
        <p className="text-text-muted text-sm">{t('none')}</p>
      ) : (
        <ul aria-label={t('results')} className="flex flex-col gap-1">
          {hits.map((hit) => (
            <li key={hit.id}>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setHits(undefined);
                  onOpen(hit);
                }}
              >
                <span className="truncate">
                  {[hit.customerName, hit.village].filter((v) => v !== null).join(' · ')}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
