'use client';

import type {
  AgentProposalFiguresDto,
  AgentSpendPerLeadDto,
  ConciergeHandoffCountDto,
} from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { actionTypeName } from '../../screens/agents';
import { formatRupees } from '../../screens/format';

// The G2 shadow review pack's figures on the WhatsApp assistant's and the Co-pilot's reports
// (docs/03-roadmap-appendix/phase2.md §8.1): per kind of suggestion how it ended and how the
// team's own work compares, what the checks refused of it, the AI spending per lead, and the
// WhatsApp assistant's chats handed to the team.

/** Each kind of suggestion: how it ended, how the team's work compares, what was refused. */
export function ProposalFigures({
  id,
  heading,
  proposals,
  compared,
}: {
  id: string;
  heading: string;
  proposals: readonly AgentProposalFiguresDto[];
  /** Whether the figures compare with the team's work (the viewer reads the activity log). */
  compared: boolean;
}) {
  const t = useTranslations('agents.shadowPack');
  const report = useTranslations('agents.conciergeReport');
  const shadow = useTranslations('agents.shadow');
  const agents = useTranslations('agents');
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-h3">
        {heading}
      </h2>
      {compared ? null : <p className="text-text-muted text-sm">{t('notCompared')}</p>}
      <dl className="flex flex-col gap-3 text-sm">
        {proposals.map((p) => {
          const name = actionTypeName(p.actionType);
          return (
            <div key={p.actionType} className="flex flex-col gap-0.5">
              <dt className="font-medium">
                {name === undefined ? agents('copilot.suggestion') : agents(`actionTypes.${name}`)}
              </dt>
              <dd className="text-text-muted">
                {report('proposalLine', {
                  shadowed: p.shadowed,
                  waiting: p.waiting,
                  approved: p.approved,
                  rejected: p.rejected,
                })}
              </dd>
              <dd>
                {t('agreementLine', {
                  agreed: p.agreed,
                  edited: p.edited,
                  disagreed: p.disagreed,
                  open: p.open,
                })}
              </dd>
              <dd className="text-text-muted">{t('decided', { count: p.decided })}</dd>
              {p.executed === 0 ? null : (
                <dd className="text-text-muted">{t('executed', { count: p.executed })}</dd>
              )}
              {name === 'whatsappReply' && p.shadowed > 0 ? (
                <dd className="text-text-muted">{t('replyInShadow')}</dd>
              ) : null}
              <dd className="text-text-muted">
                {t('refused', { count: p.filtered.reduce((sum, f) => sum + f.runs, 0) })}
                {p.filtered.length === 0 ? null : (
                  <ul className="list-disc pl-5">
                    {p.filtered.map((f) => (
                      <li key={f.reason}>
                        {shadow('refusedReason', {
                          reason: agents(`filterReason.${f.reason}`),
                          count: f.runs,
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** The agent's AI spending in the period over the leads it worked on. */
export function SpendPerLead({
  id,
  spend,
  children,
}: {
  id: string;
  spend: AgentSpendPerLeadDto;
  children?: ReactNode;
}) {
  const t = useTranslations('agents.shadowPack');
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 text-sm">
      <h2 id={id} className="text-h3">
        {t('spendHeading')}
      </h2>
      <p>
        {spend.perLead === null
          ? t('noLeads')
          : t('perLead', { perLead: formatRupees(spend.perLead), leads: spend.leads })}
      </p>
      <p className="text-text-muted">
        {t('spend', { total: formatRupees(spend.total), runs: spend.runs })}
      </p>
      <p className="text-text-muted">{t('spendNote')}</p>
      {children}
    </section>
  );
}

/**
 * The WhatsApp assistant's chats handed to the team, by reason and by whom; for a viewer who does
 * not read the activity log, a line saying who sees them.
 */
export function HandoffCounts({
  id,
  handoffs,
}: {
  id: string;
  handoffs: readonly ConciergeHandoffCountDto[] | null;
}) {
  const t = useTranslations('agents.shadowPack');
  const reasons = useTranslations('activity.values.whatsappHandoffReason');
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 text-sm">
      <h2 id={id} className="text-h3">
        {t('handoffsHeading')}
      </h2>
      {handoffs === null ? (
        <p className="text-text-muted">{t('handoffsHidden')}</p>
      ) : handoffs.length === 0 ? (
        <p className="text-text-muted">{t('noHandoffs')}</p>
      ) : (
        (['assistant', 'person'] as const).map((by) => {
          const rows = handoffs.filter((h) => h.by === by);
          return rows.length === 0 ? null : (
            <div key={by} className="flex flex-col gap-1">
              <p className="font-medium">{t(`by.${by}`)}</p>
              <ul className="text-text-muted">
                {rows.map((h) => (
                  <li key={h.reason}>
                    {t('handoffLine', { reason: reasons(h.reason), count: h.count })}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
