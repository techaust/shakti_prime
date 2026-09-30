'use client';

import type {
  PumpSizingResult,
  RooftopSizingResult,
  SizingDto,
  SizingReason,
} from '@shakti/contracts';
import { StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { oneOf } from '../../screens/audit';
import { SIZING_REASONS } from '../../screens/contract-values';
import { formatQuantity } from '../../screens/sizing';
import { DateTime } from '../date-time';

type Row = readonly [label: string, value: ReactNode];

/** One part of a result: a heading and its figures as label and value, the total last. */
function Facts({ title, rows, total }: { title: string; rows: readonly Row[]; total?: Row }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-semibold">{title}</h4>
      <dl className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-3 gap-y-1.5">
        {[...rows, ...(total === undefined ? [] : [total])].map(([label, value], index) => (
          <div
            key={label}
            className={
              total !== undefined && index === rows.length ? 'contents font-semibold' : 'contents'
            }
          >
            <dt className="text-text-muted text-sm">{label}</dt>
            <dd className="min-w-0 text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The reasons a result is outside its limits, each as a plain sentence. */
function Reasons({ reasons }: { reasons: readonly SizingReason[] }) {
  const t = useTranslations('sizing');
  if (reasons.length === 0) return null;
  return (
    <ul className="text-danger flex list-disc flex-col gap-1 pl-5 text-sm">
      {reasons.map((reason) => (
        <li key={reason}>
          {oneOf(SIZING_REASONS, reason) ? t(`reason.${reason}`) : t('result.outOfBounds')}
        </li>
      ))}
    </ul>
  );
}

function PumpFacts({ result }: { result: PumpSizingResult }) {
  const t = useTranslations('sizing.result');
  const u = useTranslations('sizing.units');
  const m = (value: number) => u('m', { value: formatQuantity(value) });
  const lph = (value: number) => u('lph', { value: formatQuantity(value, 0) });
  const { head, power, solar, suction, dutyPoint } = result;
  return (
    <>
      <section className="flex flex-col gap-2">
        <Facts
          title={t('headTitle')}
          rows={[
            [t('staticHead'), m(head.staticHeadM)],
            [t('drawdown'), m(head.drawdownM)],
            [t('friction'), m(head.frictionM)],
            [t('fittings'), m(head.fittingsM)],
          ]}
          total={[t('total'), m(head.tdhM)]}
        />
        {suction === null ? null : (
          <>
            <dl className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-3 gap-y-1.5">
              <dt className="text-text-muted text-sm">{t('suctionLift')}</dt>
              <dd className="min-w-0 text-right tabular-nums">{m(suction.suctionLiftM)}</dd>
            </dl>
            <p className="text-text-muted text-sm">
              {t('suctionLimit', { max: m(suction.maxSuctionLiftM) })}
            </p>
          </>
        )}
      </section>
      <Facts
        title={t('powerTitle')}
        rows={[
          [t('shaftHp'), u('hp', { value: formatQuantity(power.shaftHp) })],
          [t('requiredHp'), u('hp', { value: formatQuantity(power.requiredHp) })],
          [t('motorInputKw'), u('kw', { value: formatQuantity(power.motorInputKw) })],
        ]}
        total={[
          t('standardHp'),
          power.standardHp === null
            ? t('noStandardHp')
            : u('hp', { value: formatQuantity(power.standardHp) }),
        ]}
      />
      {solar === null ? null : (
        <Facts
          title={t('solarTitle')}
          rows={[[t('moduleCount'), u('panels', { count: solar.moduleCount })]]}
          total={[t('arrayKwp'), u('kwp', { value: formatQuantity(solar.arrayKwp) })]}
        />
      )}
      {dutyPoint === null ? null : (
        <section className="flex flex-col gap-2">
          <Facts
            title={t('dutyTitle')}
            rows={[
              [
                t('dutyFlow'),
                dutyPoint.dutyFlowLph === null
                  ? t('none')
                  : u('lph', { value: formatQuantity(dutyPoint.dutyFlowLph, 0) }),
              ],
              [t('requiredFlow'), lph(dutyPoint.requiredFlowLph)],
              [
                t('ratedHp'),
                dutyPoint.ratedHp === null
                  ? t('notGiven')
                  : u('hp', { value: formatQuantity(dutyPoint.ratedHp) }),
              ],
            ]}
          />
          <p className="text-text-muted text-sm">
            {t('flowBand', { min: lph(dutyPoint.minFlowLph), max: lph(dutyPoint.maxFlowLph) })}
          </p>
          {dutyPoint.minHeadM === null || dutyPoint.shutoffHeadM === null ? null : (
            <p className="text-text-muted text-sm">
              {t('curveRange', { min: m(dutyPoint.minHeadM), max: m(dutyPoint.shutoffHeadM) })}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function RooftopFacts({ result }: { result: RooftopSizingResult }) {
  const t = useTranslations('sizing.result');
  const u = useTranslations('sizing.units');
  const kwp = (value: number) => u('kwp', { value: formatQuantity(value) });
  const { rooftop } = result;
  return (
    <>
      <Facts
        title={t('rooftopTitle')}
        rows={[
          [t('neededKwp'), kwp(rooftop.neededKwp)],
          [t('roofKwp'), kwp(rooftop.roofKwp)],
          [t('sanctionedKwp'), kwp(rooftop.sanctionedKwp)],
          [t('moduleCount'), u('panels', { count: rooftop.moduleCount })],
        ]}
        total={[t('recommendedKwp'), kwp(rooftop.recommendedKwp)]}
      />
      <p className="text-text-muted text-sm">{t(`boundBy.${rooftop.boundBy}`)}</p>
    </>
  );
}

/**
 * A recorded sizing as the panel shows it (docs/design/phase1.md §6.7): whether it is within its
 * limits, why not in plain sentences, and each part of the result, the head part by part. The
 * figures are the server's; nothing is worked out here.
 */
export function SizingResult({ sizing }: { sizing: SizingDto }) {
  const t = useTranslations('sizing.result');
  return (
    <section aria-labelledby={`sizing-result-${sizing.id}`} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`sizing-result-${sizing.id}`} className="text-h3">
          {t('title')}
        </h3>
        <StatusBadge tone={sizing.inBounds ? 'success' : 'danger'}>
          {sizing.inBounds ? t('inBounds') : t('outOfBounds')}
        </StatusBadge>
      </header>
      <p className="text-text-muted text-sm">
        {t('savedAt')} <DateTime value={sizing.createdAt} />
      </p>
      <Reasons reasons={sizing.reasons} />
      {sizing.kind === 'pump' ? (
        <PumpFacts result={sizing.result} />
      ) : (
        <RooftopFacts result={sizing.result} />
      )}
    </section>
  );
}
