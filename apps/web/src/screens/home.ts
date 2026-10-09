import type { StaffRoleKey, TargetMetric, TargetPeriod } from '@shakti/contracts';
import { TARGET_METRICS, TARGET_PERIODS } from './contract-values';

/** The parts of the home page a role adds to the shortcuts (docs/03-roadmap-appendix/phase1.md §9). */
export const HOME_SECTIONS = ['caller', 'lead', 'manager', 'accounts', 'executive'] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

const SECTION_OF_ROLE: Partial<Record<StaffRoleKey, HomeSection>> = {
  tele_caller_cc: 'caller',
  tele_caller_lc: 'caller',
  sales_team_lead: 'lead',
  general_manager: 'manager',
  accounts: 'accounts',
  executive: 'executive',
};

/**
 * The sections of the home page for the roles a person holds in the companies being viewed, in the
 * page's order: a person with several roles sees the sections of each, once. A role with no
 * section of its own (Store, Inventory, Project, Field, HR) adds none and keeps the shortcuts.
 */
export function homeSections(roles: readonly StaffRoleKey[]): HomeSection[] {
  const held = new Set(roles.map((role) => SECTION_OF_ROLE[role]));
  return HOME_SECTIONS.filter((section) => held.has(section));
}

/**
 * The companies, among those viewed, where a person's role gives them a section: each section's
 * reads run in these companies, as the person acts in each (their own grants there), so a person
 * who is a team lead in one company and a caller in another has the lead section for the first.
 */
export function sectionEntities(
  roles: readonly { entityId: number; roleKey: StaffRoleKey }[],
  section: HomeSection,
): number[] {
  return roles.filter((r) => SECTION_OF_ROLE[r.roleKey] === section).map((r) => r.entityId);
}

/** The period the team view is on, from the address; the day when it is missing or unknown. */
export function periodParam(raw: string | string[] | undefined): TargetPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TARGET_PERIODS.find((period) => period === value) ?? 'day';
}

/** How full a progress meter is, 0 to 100: a beaten target fills it, no target leaves it empty. */
export function meterPercent(fraction: number | null): number {
  if (fraction === null || !Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.min(100, Math.round(fraction * 100));
}

/** Whether a target is met or beaten. */
export function targetMet(fraction: number | null): boolean {
  return fraction !== null && fraction >= 1;
}

/** A figure of a metric: whole numbers for counts, up to two decimals for kW. */
export function metricNumber(metric: TargetMetric, value: number): string {
  const options: Intl.NumberFormatOptions =
    metric === 'kw' ? { maximumFractionDigits: 2 } : { maximumFractionDigits: 0 };
  return new Intl.NumberFormat('en-IN', options).format(value);
}

/** The metrics in the order the screens list them. */
export const METRIC_ORDER: readonly TargetMetric[] = TARGET_METRICS;

/**
 * The value of the Targets form's "For" choice, `scope:id`, and back: one field names both
 * whether it is a person or a team and which.
 */
export function subjectValue(scope: 'caller' | 'team', id: string): string {
  return `${scope}:${id}`;
}

export function parseSubject(value: string): { scope: 'caller' | 'team'; id: string } | undefined {
  const [scope, id] = value.split(':');
  if ((scope !== 'caller' && scope !== 'team') || id === undefined || id === '') return undefined;
  return { scope, id };
}

/** A typed target figure: digits with up to two decimals, or nothing for the form to refuse. */
export function parseTargetValue(typed: string): number | undefined {
  const text = typed.trim().replaceAll(',', '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return undefined;
  return Number(text);
}
