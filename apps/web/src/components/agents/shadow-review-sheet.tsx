import type {
  SampleFacts,
  ShadowSampleAgreement,
  ShadowSampleDidDto,
  ShadowSampleDraftDto,
  ShadowSampleDto,
  ShadowSampleItemDto,
  ShadowSampleState,
} from '@shakti/contracts';
import { StatusBadge, type StatusTone } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DateTime } from '../date-time';
import { actionTypeName } from '../../screens/agents';
import { COPILOT_FACT_VALUES } from '../../screens/contract-values';
import { customerHref } from '../../screens/customers';
import { formatCount, formatDate, formatDateTime } from '../../screens/format';

// The suggestions to review of the WhatsApp assistant or the Co-pilot (the G2 shadow review pack,
// docs/03-roadmap-appendix/phase2.md §8.1): up to 50 suggestions spread evenly over a period, each
// beside what the team sent or did, for the Executive to read on screen or on paper. Read-only and
// rendered on the server: the customer's words are shown as stored (masked) and as text, never as
// markup.

const STATE_TONE: Record<ShadowSampleState, StatusTone> = {
  shadowed: 'neutral',
  waiting: 'accent',
  approved: 'success',
  edited: 'success',
  rejected: 'warning',
};

const AGREEMENT_TONE: Record<ShadowSampleAgreement, StatusTone> = {
  agree: 'success',
  edited: 'info',
  disagree: 'warning',
  open: 'neutral',
};

const TASK_KINDS = ['callback', 'follow_up', 'nurture', 'review'] as const;
const OCCASIONS = ['nurture', 'quote_expiry'] as const;
const isOneOf = <T extends string>(list: readonly T[], value: string | null): value is T =>
  value !== null && (list as readonly string[]).includes(value);

type Translate = Awaited<ReturnType<typeof getTranslations>>;

async function words() {
  const [t, agents, facts, kinds, occasions] = await Promise.all([
    getTranslations('agents.shadowPack.review'),
    getTranslations('agents'),
    getTranslations('qualification.facts'),
    getTranslations('customers.tasks.kind'),
    getTranslations('activity.values.templateOccasion'),
  ]);
  return { t, agents, facts, kinds, occasions };
}
type Words = Awaited<ReturnType<typeof words>>;

function typeName(w: Words, actionType: string): string {
  const name = actionTypeName(actionType);
  return name === undefined ? w.agents('copilot.suggestion') : w.agents(`actionTypes.${name}`);
}

function FactList({ facts, w }: { facts: SampleFacts; w: Words }) {
  return (
    <ul>
      {COPILOT_FACT_VALUES.flatMap((fact) => {
        const value = facts[fact];
        return value === undefined
          ? []
          : [<li key={fact}>{w.t('fact', { fact: w.facts(fact), value: formatCount(value) })}</li>];
      })}
    </ul>
  );
}

function taskLine(w: Words, kind: string, dueAt: string | null, title: string | null): ReactNode {
  const name = isOneOf(TASK_KINDS, kind) ? w.kinds(kind) : w.kinds('follow_up');
  return (
    <span className="flex flex-col">
      <span>{dueAt === null ? name : w.t('task', { kind: name, due: formatDateTime(dueAt) })}</span>
      {title === null ? null : <span>{w.t('taskTitle', { title })}</span>}
    </span>
  );
}

function Draft({ draft, w }: { draft: ShadowSampleDraftDto; w: Words }) {
  switch (draft.kind) {
    case 'reply':
      return <span className="whitespace-pre-wrap">{draft.text}</span>;
    case 'facts':
      return <FactList facts={draft.facts} w={w} />;
    case 'task':
      return taskLine(w, draft.taskKind, draft.dueAt, draft.title);
    case 'template': {
      const name = draft.templateLabel ?? draft.templateName;
      return (
        <span>
          {isOneOf(OCCASIONS, draft.occasion)
            ? w.t('templateFor', { name, occasion: w.occasions(draft.occasion) })
            : name}
        </span>
      );
    }
  }
}

function Did({ did, w }: { did: ShadowSampleDidDto | null; w: Words }) {
  if (did === null) return <span className="text-text-muted">{w.t('nothingYet')}</span>;
  switch (did.kind) {
    case 'message':
      return (
        <span className="flex flex-col gap-1">
          <span className="whitespace-pre-wrap">
            {did.body ?? w.t('template', { name: did.templateLabel ?? '' })}
          </span>
          {did.fromDraft ? (
            <span className="text-text-muted text-xs">{w.t('fromDraft')}</span>
          ) : null}
        </span>
      );
    case 'facts':
      return <FactList facts={did.facts} w={w} />;
    case 'task':
      return taskLine(w, did.taskKind, did.dueAt, did.title);
    case 'template':
      return <span>{w.t('template', { name: did.templateLabel ?? '' })}</span>;
  }
}

function Item({
  item,
  number,
  entityId,
  w,
  unknownCustomer,
}: {
  item: ShadowSampleItemDto;
  number: number;
  entityId: number;
  w: Words;
  unknownCustomer: string;
}) {
  const t = w.t;
  return (
    <li className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4 break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{t('item', { number, type: typeName(w, item.actionType) })}</h3>
        <span className="text-text-muted text-sm">
          <DateTime value={item.createdAt} />
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-text-muted">{t('customer')}</dt>
        <dd>
          {item.accountId !== null && item.customerName !== null ? (
            <Link href={customerHref(item.accountId, entityId)}>{item.customerName}</Link>
          ) : (
            <span className="text-text-muted">{unknownCustomer}</span>
          )}
        </dd>
        {item.draft.kind === 'reply' ? (
          <>
            <dt className="text-text-muted">{t('wrote')}</dt>
            <dd className="whitespace-pre-wrap">
              {item.asked ?? <span className="text-text-muted">{t('file')}</span>}
            </dd>
          </>
        ) : null}
        <dt className="text-text-muted">{t('suggested')}</dt>
        <dd>
          <Draft draft={item.draft} w={w} />
        </dd>
        <dt className="text-text-muted">{t('did')}</dt>
        <dd>
          <Did did={item.did} w={w} />
        </dd>
        <dt className="text-text-muted">{t('happened')}</dt>
        <dd>
          <StatusBadge tone={STATE_TONE[item.state]}>{t(`state.${item.state}`)}</StatusBadge>
        </dd>
        <dt className="text-text-muted">{t('agreement')}</dt>
        <dd>
          <StatusBadge tone={AGREEMENT_TONE[item.agreement]}>
            {t(`agreementValue.${item.agreement}`)}
          </StatusBadge>
        </dd>
      </dl>
    </li>
  );
}

/** The period's figures, what the checks refused, and the suggestions, oldest first. */
export async function ShadowReviewSheet({
  sample,
  companyName,
}: {
  sample: ShadowSampleDto;
  companyName: string;
}) {
  const w = await words();
  const shadow: Translate = await getTranslations('agents.shadow');
  const t = w.t;
  return (
    <div className="flex flex-col gap-6" data-testid="shadow-review">
      <section aria-labelledby="review-period" className="flex flex-col gap-1">
        <h2 id="review-period" className="text-h3">
          {t('period', {
            company: companyName,
            from: formatDate(sample.from),
            to: formatDate(sample.to),
          })}
        </h2>
        <p className="text-sm">
          {t('count', { shown: sample.items.length, count: sample.proposals })}
        </p>
      </section>
      <section aria-label={t('passed')} className="flex flex-col gap-1 text-sm">
        {sample.filtered.length === 0 ? (
          <p className="text-text-muted">{t('noneRefused')}</p>
        ) : (
          <>
            <p>{t('passed')}</p>
            <ul className="text-text-muted list-disc pl-5">
              {sample.filtered.map((f) => (
                <li key={`${f.actionType}:${f.reason}`}>
                  {t('refusedLine', {
                    type: typeName(w, f.actionType),
                    reason: w.agents(`filterReason.${f.reason}`),
                    count: f.runs,
                  })}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {sample.items.length === 0 ? (
        <p className="text-text-muted">{t('empty')}</p>
      ) : (
        <ol aria-label={t('listLabel')} className="flex flex-col gap-3">
          {sample.items.map((item, at) => (
            <Item
              key={item.actionId}
              item={item}
              number={at + 1}
              entityId={sample.entityId}
              w={w}
              unknownCustomer={shadow('unknownCustomer')}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
