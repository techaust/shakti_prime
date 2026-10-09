import type { MetricProgressDto, PeriodProgressDto } from '@shakti/contracts';
import { cn } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import { formatDate } from '../../screens/format';
import { meterPercent, metricNumber, targetMet } from '../../screens/home';

/**
 * One metric against its target: its name, "12 of 30", and a meter that fills to the share done.
 * Colour is not the only signal: the figure and the words say the same, and a met target says so.
 */
export async function ProgressMeter({ progress }: { progress: MetricProgressDto }) {
  const t = await getTranslations('home.progress');
  const metrics = await getTranslations('targets.metric');
  if (progress.target === null) return null;
  const percent = meterPercent(progress.fraction);
  const name = metrics(progress.metric);
  const figures = t('of', {
    actual: metricNumber(progress.metric, progress.actual),
    target: metricNumber(progress.metric, progress.target),
  });
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{name}</span>
        <span className="text-text-muted text-sm tabular-nums">
          {figures}
          {targetMet(progress.fraction) ? ` · ${t('met')}` : ''}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${name}: ${figures}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-surface-2 h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-(--motion-fast) ease-out',
            targetMet(progress.fraction) ? 'bg-success' : 'bg-accent',
          )}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </li>
  );
}

/** The meters of the metrics that have a target, or nothing when none has. */
export function hasTargets(metrics: readonly MetricProgressDto[]): boolean {
  return metrics.some((m) => m.target !== null);
}

/**
 * A person's progress in today, this week and this month: each period that has at least one
 * target shows its dates and its meters. `empty` is the sentence when no period has a target.
 */
export async function PeriodProgress({
  periods,
  empty,
}: {
  periods: readonly PeriodProgressDto[];
  empty: string;
}) {
  const t = await getTranslations('home.progress');
  const shown = periods.filter((p) => hasTargets(p.metrics));
  if (shown.length === 0) return <p className="text-text-muted">{empty}</p>;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {shown.map((p) => (
        <div
          key={p.period}
          className="bg-surface border-border flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-col">
            <h3 className="font-semibold">{t(`period.${p.period}`)}</h3>
            {p.period === 'day' ? null : (
              <span className="text-text-muted text-sm">
                {t('range', { from: formatDate(p.startsOn), to: formatDate(p.endsOn) })}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-3">
            {p.metrics.map((m) => (
              <ProgressMeter key={m.metric} progress={m} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A figure with its name, for the counts on the home page. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface border-border flex flex-col gap-1 rounded-lg border p-4">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="text-h2 tabular-nums">{value}</dd>
      {hint === undefined ? null : <dd className="text-text-muted text-sm">{hint}</dd>}
    </div>
  );
}

/** A home page section: a heading and its content. */
export function HomeBlock({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-h3">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
