'use client';

import type {
  MilestoneStep,
  MilestoneTemplateDto,
  PaymentTermsDto,
  Segment,
} from '@shakti/contracts';
import { Button, Field, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { listPaymentTerms } from '../../actions/finance';
import { SEGMENTS } from '../../screens/contract-values';
import { formatDate, formatRupees } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import type { CommandFailure } from '../screens/use-command';
import { RowsTable } from './rows-table';

/** The editor loads on first use, so the page carries none of its code until then. */
const TermsEditor = dynamic(() => import('./terms-editor').then((m) => m.TermsEditor));

interface Company {
  id: number;
  name: string;
}

/**
 * Settings › Payment terms (docs/03-roadmap-appendix/phase5.md §6.1, question 6 (a)): one
 * company's terms for one kind of order at a time. The current version is shown with its
 * payments, or the standard terms where the company has published none; the Executive publishes a
 * changed version, which orders confirmed from then on follow. Earlier versions stay listed.
 */
export function PaymentTermsScreen({
  companies,
  initial,
}: {
  companies: readonly Company[];
  initial: PaymentTermsDto;
}) {
  const t = useTranslations('finance.terms');
  const [view, setView] = useState(initial);
  const [segment, setSegment] = useState<Segment>('farmer_pumps');
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const versions = view.templates.filter((x) => x.segment === segment);
  const current = versions[0];

  async function load(entityId: number) {
    const result = await settle(() => listPaymentTerms({ entityId }));
    if (result.ok) {
      setView(result.data);
      setFailure(undefined);
    } else {
      setFailure((previous) => ({
        error: result.error,
        reference: result.reference,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {companies.length > 1 ? (
          <Field id="terms-company" label={t('company')}>
            <Select
              value={String(view.entityId)}
              onChange={(e) => {
                void load(Number(e.target.value));
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
        <Field id="terms-segment" label={t('segment')}>
          <Select
            value={segment}
            onChange={(e) => {
              setSegment(e.target.value as Segment);
            }}
          >
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {t(`segments.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FailureMessage failure={failure} />

      <section aria-labelledby="terms-current" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="terms-current" className="text-h3">
            {t('current')}
          </h2>
          <Button
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('edit')}
          </Button>
        </div>
        {current === undefined ? (
          <p className="text-text-muted">{t('defaultTerms')}</p>
        ) : (
          <p className="text-text-muted text-sm">{versionLine(current, t)}</p>
        )}
        <StepsTable steps={current?.steps ?? view.defaultSteps} />
      </section>

      <section aria-labelledby="terms-history" className="flex flex-col gap-2">
        <h2 id="terms-history" className="text-h3">
          {t('history')}
        </h2>
        {versions.length < 2 ? (
          <p className="text-text-muted">{t('noHistory')}</p>
        ) : (
          versions.slice(1).map((version) => (
            <details key={version.id} className="border-border rounded-lg border p-3">
              <summary className="cursor-pointer">{versionLine(version, t)}</summary>
              <div className="mt-3">
                <StepsTable steps={version.steps} />
              </div>
            </details>
          ))
        )}
      </section>

      {editing ? (
        <TermsEditor
          entityId={view.entityId}
          segment={segment}
          initial={current?.steps ?? view.defaultSteps}
          onClose={() => {
            setEditing(false);
          }}
          onDone={() => {
            setEditing(false);
            toast.success(t('published'));
            void load(view.entityId);
          }}
        />
      ) : null}
    </div>
  );
}

type TermsT = ReturnType<typeof useTranslations<'finance.terms'>>;

function versionLine(version: MilestoneTemplateDto, t: TermsT): string {
  return t('version', {
    version: version.version,
    date: formatDate(new Date(version.publishedAt)),
    name: version.publishedByName ?? '',
  });
}

function StepsTable({ steps }: { steps: readonly MilestoneStep[] }) {
  const t = useTranslations('finance');
  return (
    <RowsTable
      caption={t('terms.stepsCaption')}
      titleLabel={t('terms.columns.payment')}
      actionsLabel={t('tab.columns.actions')}
      columns={[
        { id: 'share', label: t('terms.columns.share') },
        { id: 'due', label: t('terms.columns.due') },
        { id: 'loan', label: t('terms.columns.loan') },
      ]}
      rows={steps.map((step) => ({
        key: step.key,
        title: step.label,
        cells: {
          share:
            step.percent === null
              ? formatRupees(step.amount ?? '0.00')
              : t('tab.percent', { percent: step.percent }),
          due: t(`dueRule.${step.dueRule}`, { days: step.dueDays ?? 0 }),
          loan: t(`loanGate.${step.loanGate}`),
        },
      }))}
    />
  );
}
