// Settings › Lead sources and the qualification card (docs/03-roadmap-appendix/phase2.md §6.2):
// pure functions, so the screens and their tests share them. Browser code: types only from the
// contracts, values from `contract-values`.

import type {
  IngestFieldTarget,
  IngestSourceDto,
  IngestSourceProvider,
  LeadQualificationDto,
  LeadQualificationFact,
} from '@shakti/contracts';
import { INGEST_FIELD_TARGETS, LEAD_QUALIFICATION_FACTS } from './contract-values';

/**
 * The card's save: only the facts the form changed, a cleared box as `null`, a number as a number.
 * A box that does not read as a number is sent as typed, so the command's check names it.
 */
export function qualificationInput(
  current: LeadQualificationDto,
  read: (name: string) => string,
): {
  entityId: number;
  opportunityId: string;
  facts: Partial<Record<LeadQualificationFact, number | string | null>>;
} {
  const facts: Partial<Record<LeadQualificationFact, number | string | null>> = {};
  for (const fact of LEAD_QUALIFICATION_FACTS) {
    const typed = read(fact).trim();
    const before = current[fact];
    if (typed === '') {
      if (before !== null) facts[fact] = null;
      continue;
    }
    if (fact === 'discomConsumerNo') {
      if (typed !== before) facts[fact] = typed;
      continue;
    }
    const n = Number(typed);
    const value = Number.isFinite(n) ? n : typed;
    if (value !== before) facts[fact] = value;
  }
  return { entityId: current.entityId, opportunityId: current.opportunityId, facts };
}

/** One row of the field map editor: a question of the form and what it fills, if anything. */
export interface MapRow {
  key: string;
  label: string | null;
  target: IngestFieldTarget | '';
}

/**
 * The editor's rows: every question the form asked in its newest lead (the preview), then any
 * question the map names that the newest lead did not carry, in the map's order.
 */
export function mapRows(source: IngestSourceDto | undefined): MapRow[] {
  if (source === undefined) return [];
  const rows: MapRow[] = source.lastQuestions.map((q) => ({
    key: q.key,
    label: q.label,
    target: source.fieldMap[q.key] ?? '',
  }));
  const seen = new Set(rows.map((r) => r.key));
  for (const [key, target] of Object.entries(source.fieldMap)) {
    if (!seen.has(key)) rows.push({ key, label: null, target });
  }
  return rows;
}

/** The map the editor's rows make: only the rows that fill something, each question once. */
export function fieldMapOf(rows: readonly MapRow[]): Record<string, IngestFieldTarget> {
  const map: Record<string, IngestFieldTarget> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '' || row.target === '' || key in map) continue;
    if ((INGEST_FIELD_TARGETS as readonly string[]).includes(row.target)) map[key] = row.target;
  }
  return map;
}

/** Whether the map names the person: a phone, and a full name or a first name. */
export function mapIsComplete(map: Readonly<Record<string, IngestFieldTarget>>): boolean {
  const targets = new Set(Object.values(map));
  return targets.has('phone') && (targets.has('fullName') || targets.has('firstName'));
}

/** What a form's external id is called on screen, by its kind of source. */
export function externalIdLabel(provider: IngestSourceProvider): 'formId' | 'siteHost' {
  return provider === 'website' ? 'siteHost' : 'formId';
}
