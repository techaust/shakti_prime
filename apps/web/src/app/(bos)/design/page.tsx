import { aliases, colors, contrastRatio, scale, type Theme } from '@shakti/tokens';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Button, Field, TextInput } from '../../../components/form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('design');
  return { title: t('title') };
}

const THEMES: readonly Theme[] = ['light', 'dark'];
const TYPE_ROLES = [
  'display',
  'h1',
  'h2',
  'h3',
  'body',
  'body-dense',
  'caption',
  'numeric',
] as const;
const STATUSES = ['success', 'warning', 'danger', 'info'] as const;
const STAGES = Object.keys(aliases).filter((name) => name.startsWith('stage-'));
const CHARTS = Object.keys(aliases).filter((name) => name.startsWith('chart-'));

/**
 * Every colour, text size and control in light and dark side by side (DESIGN.md §2.1, §8), for
 * the design review. Each colour shows its contrast ratio against a card surface.
 */
export default async function DesignPage() {
  const t = await getTranslations('design');
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-[590]">
          {t('title')}
        </h1>
        <p className="text-text-muted">{t('intro')}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {THEMES.map((theme) => (
          <ThemePanel key={theme} theme={theme} />
        ))}
      </div>
    </main>
  );
}

async function ThemePanel({ theme }: { theme: Theme }) {
  const t = await getTranslations('design');
  const surface = colors.surface[theme];
  return (
    <section
      aria-labelledby={`design-${theme}`}
      className={`theme-${theme} bg-bg text-text border-border flex flex-col gap-8 rounded-[var(--radius-xl)] border p-6`}
    >
      <h2
        id={`design-${theme}`}
        className="text-[length:var(--font-h2-size)] leading-[var(--font-h2-line)] font-[590]"
      >
        {t(theme)}
      </h2>

      <Section title={t('colours')}>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(colors).map(([name, value]) => (
            <li
              key={name}
              className="bg-surface border-border flex items-center gap-3 rounded-[var(--radius-md)] border p-2"
            >
              <span
                aria-hidden
                className="border-border size-8 shrink-0 rounded-[var(--radius-sm)] border"
                style={{ background: `var(--${name})` }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-[510]">{name}</span>
                <span className="text-text-muted text-xs tabular-nums">
                  {t('ratio', {
                    hex: value[theme],
                    ratio: contrastRatio(value[theme], surface).toFixed(2),
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('type')}>
        <ul className="flex flex-col gap-3">
          {TYPE_ROLES.map((role) => {
            const font = scale.font[role];
            return (
              <li key={role} className="flex flex-col">
                <span className="text-text-subtle text-xs">
                  {t('typeRole', { role, size: font.size, line: font.line, weight: font.weight })}
                </span>
                <span
                  style={{
                    fontSize: `var(--font-${role}-size)`,
                    lineHeight: `var(--font-${role}-line)`,
                    fontWeight: font.weight,
                  }}
                  className={role === 'numeric' ? 'tabular-nums' : undefined}
                >
                  {role === 'numeric' ? t('numericSample') : t('typeSample')}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t('buttons')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button">{t('primary')}</Button>
          <Button type="button" variant="secondary">
            {t('secondary')}
          </Button>
          <Button type="button" variant="link">
            {t('link')}
          </Button>
          <Button type="button" disabled>
            {t('unavailable')}
          </Button>
        </div>
      </Section>

      <Section title={t('fields')}>
        <div className="bg-surface border-border flex flex-col gap-4 rounded-[var(--radius-lg)] border p-4">
          <Field label={t('fieldLabel')} id={`design-${theme}-name`}>
            <TextInput id={`design-${theme}-name`} placeholder={t('fieldHint')} />
          </Field>
          <Field label={t('fieldErrorLabel')} id={`design-${theme}-phone`}>
            <TextInput
              id={`design-${theme}-phone`}
              defaultValue={t('fieldErrorValue')}
              className="border-danger"
              aria-invalid
            />
          </Field>
          <p className="text-danger text-sm">{t('fieldError')}</p>
        </div>
      </Section>

      <Section title={t('statuses')}>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <span
              key={status}
              className="rounded-full px-2.5 py-0.5 text-xs font-[510]"
              style={{ background: `var(--${status}-soft)`, color: `var(--${status})` }}
            >
              {t(`status.${status}`)}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {STAGES.map((stage) => (
            <span key={stage} className="inline-flex items-center gap-1.5 text-sm">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: `var(--${stage})` }}
              />
              {t(`stage.${stage}`)}
            </span>
          ))}
        </div>
      </Section>

      <Section title={t('charts')}>
        <div className="flex h-24 items-end gap-2">
          {CHARTS.map((chart, i) => (
            <span
              key={chart}
              aria-hidden
              className="flex-1 rounded-t-[var(--radius-sm)]"
              style={{ background: `var(--${chart})`, height: `${String(40 + i * 10)}%` }}
            />
          ))}
        </div>
      </Section>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-text-muted text-sm font-[590]">{title}</h3>
      {children}
    </div>
  );
}
