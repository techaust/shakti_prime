'use client';

import type { DialPlanDto } from '@shakti/contracts';
import { StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { planCall } from '../../actions/calling';
import { formatDateTime, formatPhone } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/**
 * How a call to the lead's main number would go out (docs/03-roadmap-appendix/phase2.md §5.2, PRD
 * TEL-04), in the Cold Caller and Converting workspaces: whether it is a service or a sales call
 * and why, the company's number it would go out on, and every calling rule it would break. Read
 * again whenever another lead opens. The Dial key that places the call comes with T3.
 */
export function CallPlan({ entityId, opportunityId }: { entityId: number; opportunityId: string }) {
  const t = useTranslations('calling.plan');
  const { load, pending, failure } = useQuery<DialPlanDto>();
  const [plan, setPlan] = useState<{ lead: string; dto: DialPlanDto } | undefined>();

  useEffect(() => {
    load(
      () => planCall({ entityId, opportunityId }),
      (dto) => {
        setPlan({ lead: opportunityId, dto });
      },
    );
  }, [entityId, opportunityId, load]);

  // A plan of the lead before is never shown under this one's name.
  const shown = plan?.lead === opportunityId ? plan.dto : undefined;
  const series = shown?.purpose === 'service' ? '160' : '140';

  return (
    <section
      aria-labelledby={`call-plan-${opportunityId}`}
      aria-busy={pending}
      className="border-border flex min-w-0 flex-col gap-2 border-t pt-3"
      data-testid="call-plan"
    >
      <h3 id={`call-plan-${opportunityId}`} className="font-semibold">
        {t('title')}
      </h3>
      {shown === undefined ? (
        failure === undefined ? (
          <p className="text-text-muted text-sm" role="status">
            {t('loading')}
          </p>
        ) : (
          <FailureMessage failure={failure} />
        )
      ) : (
        <>
          <p className="text-sm">{t(`purpose.${shown.purposeReason}`)}</p>
          <p className="text-sm">
            {shown.callerId === null
              ? t('noNumber', { series })
              : t('number', { series, number: formatPhone(shown.callerId) })}
          </p>
          {shown.purpose === 'promotional' && shown.dndCheckedAt !== null ? (
            <p className="text-text-muted text-sm">
              {t('dndChecked', { when: formatDateTime(shown.dndCheckedAt) })}
            </p>
          ) : null}
          {shown.allowed ? (
            <p className="flex items-center gap-2 text-sm">
              <StatusBadge tone="success">{t('allowedBadge')}</StatusBadge>
              {t('allowed')}
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex items-center gap-2">
                <StatusBadge tone="warning">{t('refusedBadge')}</StatusBadge>
                {t('refused')}
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {shown.refusals.map((reason) => (
                  <li key={reason}>{t(`refusal.${reason}`)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
