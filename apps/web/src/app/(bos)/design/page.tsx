import {
  aliases,
  colors,
  contrastRatio,
  resolve,
  scale,
  shadows,
  type Theme,
} from '@shakti/tokens';
import type { Metadata } from 'next';
import { getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ComponentGallery, type DesignCopy } from '../../../components/design/component-gallery';
import { Page } from '../../../components/shell/page';
import { navRequires, visibleNav } from '../../../nav';
import { screenAccess } from '../../../screens/access';

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
  'body-phone',
  'caption',
  'numeric',
] as const;
const STAGES = [
  'stage-new',
  'stage-contacted',
  'stage-qualified',
  'stage-quoted',
  'stage-won',
  'stage-lost',
] as const satisfies readonly (keyof typeof aliases)[];
/** The status scales of DESIGN.md §2.4 other than the lead stages, each with its meaning. */
const ALIAS_GROUPS = [
  { group: 'sla', names: ['sla-ok', 'sla-warn', 'sla-breach'] },
  { group: 'stock', names: ['stock-healthy', 'stock-low', 'stock-out', 'stock-reserved'] },
  { group: 'auto', names: ['auto-suggest', 'auto-approve', 'auto-automatic'] },
] as const;
const ENTITY_DOTS = ['entity-1', 'entity-2', 'entity-3', 'entity-4'] as const;
const CHARTS = Object.keys(aliases).filter((name) => name.startsWith('chart-'));
const SPACES = Object.entries(scale.space);
const RADII = Object.entries(scale.radius);
const MOTIONS = Object.entries(scale.motion);

/**
 * Every token and every `@shakti/ui` component in light and dark side by side (DESIGN.md §2.1,
 * §8, §10), for the design review: each colour with its contrast on a card, the status scales,
 * type sizes, spacing, corners, shadows, motion and focus, and the §2.5 contrast pairs.
 */
export default async function DesignPage() {
  const { principal } = await screenAccess(navRequires('design'));
  const t = await getTranslations('design');
  const copy: DesignCopy = (await getMessages()).design;
  const navIds = visibleNav(principal.permissions).map((item) => item.id);
  return (
    <Page title={t('title')} description={t('intro')}>
      <div className="grid gap-6 xl:grid-cols-2">
        {THEMES.map((theme) => (
          <ThemePanel key={theme} theme={theme} copy={copy} navIds={navIds} />
        ))}
      </div>
    </Page>
  );
}

async function ThemePanel({
  theme,
  copy,
  navIds,
}: {
  theme: Theme;
  copy: DesignCopy;
  navIds: readonly string[];
}) {
  const t = await getTranslations('design');
  const surface = colors.surface[theme];
  const resolved = resolve(theme);
  return (
    <section
      aria-labelledby={`design-${theme}`}
      className={`theme-${theme} bg-bg text-text border-border flex min-w-0 flex-col gap-8 rounded-xl border p-4 sm:p-6`}
    >
      <h2 id={`design-${theme}`} className="text-h2 tracking-[-0.01em]">
        {t(theme)}
      </h2>

      <Section title={t('colours')}>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(colors).map(([name, value]) => (
            <li
              key={name}
              className="bg-surface border-border flex items-center gap-3 rounded-md border p-2"
            >
              <span
                aria-hidden
                className="border-border size-8 shrink-0 rounded-sm border"
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

      <Section title={t('aliases')}>
        <AliasList title={t('aliasGroup.stage')}>
          {STAGES.map((stage) => (
            <AliasItem
              key={stage}
              name={stage}
              label={t(`stage.${stage}`)}
              value={t('aliasValue', { name: stage, hex: resolved[stage] })}
            />
          ))}
        </AliasList>
        {ALIAS_GROUPS.map(({ group, names }) => (
          <AliasList key={group} title={t(`aliasGroup.${group}`)}>
            {names.map((name) => (
              <AliasItem
                key={name}
                name={name}
                label={t(`alias.${name}`)}
                value={t('aliasValue', { name, hex: resolved[name] })}
              />
            ))}
          </AliasList>
        ))}
        <AliasList title={t('aliasGroup.entity')}>
          {ENTITY_DOTS.map((name) => (
            <AliasItem
              key={name}
              name={name}
              value={t('aliasValue', { name, hex: resolved[name] })}
            />
          ))}
        </AliasList>
      </Section>

      <Section title={t('charts')}>
        <div className="flex h-24 items-end gap-2">
          {CHARTS.map((chart, i) => (
            <span
              key={chart}
              aria-hidden
              className="flex-1 rounded-t-sm"
              style={{ background: `var(--${chart})`, height: `${String(40 + i * 10)}%` }}
            />
          ))}
        </div>
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

      <Section title={t('measures')}>
        <h4 className="text-text-subtle text-xs font-[510]">{t('spacing')}</h4>
        <ul className="flex flex-col gap-1.5">
          {SPACES.map(([step, px]) => (
            <li key={step} className="flex items-center gap-3">
              <span
                aria-hidden
                className="bg-accent h-3 shrink-0 rounded-sm"
                style={{ width: `var(--space-${step})` }}
              />
              <span className="text-text-muted text-xs tabular-nums">
                {t('pxValue', { name: `space-${step}`, px })}
              </span>
            </li>
          ))}
        </ul>

        <h4 className="text-text-subtle text-xs font-[510]">{t('radius')}</h4>
        <ul className="flex flex-wrap gap-4">
          {RADII.map(([name, px]) => (
            <li key={name} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden
                className="bg-surface-2 border-border-strong size-12 border"
                style={{ borderRadius: `var(--radius-${name})` }}
              />
              <span className="text-text-muted text-xs tabular-nums">
                {t('pxValue', { name: `radius-${name}`, px })}
              </span>
            </li>
          ))}
        </ul>

        <h4 className="text-text-subtle text-xs font-[510]">{t('shadows')}</h4>
        <ul className="flex flex-wrap gap-4">
          {Object.keys(shadows).map((name) => (
            <li
              key={name}
              className="bg-surface border-border flex h-16 w-32 items-center justify-center rounded-lg border text-xs"
              style={{ boxShadow: `var(--${name})` }}
            >
              {name}
            </li>
          ))}
        </ul>

        <h4 className="text-text-subtle text-xs font-[510]">{t('motion')}</h4>
        <p className="text-text-muted text-xs">{t('motionHint')}</p>
        <ul className="flex flex-wrap gap-4">
          {MOTIONS.map(([name, ms]) => (
            <li key={name} className="flex flex-col items-start gap-1.5">
              <span
                aria-hidden
                className="bg-surface-2 border-border hover:bg-accent-soft size-12 rounded-md border transition-[translate,background-color] ease-out hover:translate-x-4"
                style={{ transitionDuration: `var(--motion-${name})` }}
              />
              <span className="text-text-muted text-xs tabular-nums">
                {t('msValue', { name: `motion-${name}`, ms })}
              </span>
            </li>
          ))}
        </ul>

        <h4 className="text-text-subtle text-xs font-[510]">{t('focus')}</h4>
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="bg-surface border-border-strong outline-focus h-9 w-32 rounded-md border outline-2 outline-offset-2"
          />
          <span className="text-text-muted text-xs">
            {t('focusValue', { width: scale.focusRing.width, offset: scale.focusRing.offset })}
          </span>
        </div>
      </Section>

      <ComponentGallery theme={theme} copy={copy} navIds={navIds} />
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-text-muted text-sm font-[590]">{title}</h3>
      {children}
    </div>
  );
}

function AliasList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-text-subtle text-xs font-[510]">{title}</h4>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</ul>
    </div>
  );
}

function AliasItem({ name, label, value }: { name: string; label?: string; value: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{ background: `var(--${name})` }}
      />
      {label === undefined ? null : <span>{label}</span>}
      <span className="text-text-subtle text-xs tabular-nums">{value}</span>
    </li>
  );
}
