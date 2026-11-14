import {
  LeadQualificationFactsSchema,
  PhoneInputSchema,
  type IngestConsent,
  type IngestFieldTarget,
  type LeadQualificationFact,
  type LeadQualificationFacts,
} from '@shakti/contracts';
import { createHash } from 'node:crypto';

/**
 * Reading a form's answers into a lead (docs/03-roadmap-appendix/phase2.md §6.2), as the connected
 * source's field map says: pure, so every rule is tested without a provider. A question the map
 * does not name is not read; a value that does not read as its field (a phone that is no phone, a
 * depth that is no number) is left out, never guessed; a form whose map gives no name or no phone
 * is not a lead (`missing`), and the handler reports it rather than guessing.
 */

/** One answer of a form: the question's own key, its label when the provider gives one, the value. */
export interface FormAnswer {
  key: string;
  label: string | null;
  value: string;
}

/** What the mapping reads of a connected source. */
export interface SourceMapping {
  fieldMap: Readonly<Record<string, IngestFieldTarget>>;
  consent: {
    questionKey: string;
    textVersion: string;
    channels: IngestConsent['channels'];
    purpose: IngestConsent['purpose'];
  } | null;
}

export type MappedLead =
  | {
      ok: true;
      contact: { name: string; phone: string };
      site: { village?: string; pin?: string } | undefined;
      qualification: LeadQualificationFacts | undefined;
      consent: IngestConsent | undefined;
      message: string | undefined;
    }
  | { ok: false; missing: ('name' | 'phone')[] };

/** The answers a person ticking a box or choosing "yes" gives, in English and Roman Hindi. */
const TICKED = new Set(['yes', 'y', 'true', '1', 'agree', 'i agree', 'checked', 'on', 'haan', 'ha']);

/** Whether a consent question's answer is a tick. Anything else, an empty answer included, is not. */
export function isTicked(value: string): boolean {
  return TICKED.has(value.trim().toLowerCase());
}

const FACT_TARGETS: readonly LeadQualificationFact[] = [
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
  'discomConsumerNo',
];

/** A number as a form writes it ("1,200 ft", "7.5 HP"): its first number, or undefined. */
function numberIn(value: string): number | undefined {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(value);
  if (match === null) return undefined;
  const n = Number(match[0].replaceAll(',', ''));
  return Number.isFinite(n) ? n : undefined;
}

/** A fact's value as the contract takes it, or undefined when the answer does not read as it. */
function factValue(fact: LeadQualificationFact, value: string): number | string | undefined {
  const schema = LeadQualificationFactsSchema.shape[fact];
  const candidate =
    fact === 'discomConsumerNo'
      ? value.trim()
      : fact === 'requiredHp' || fact === 'sanctionedLoadKw'
        ? numberIn(value)
        : (() => {
            const n = numberIn(value);
            return n === undefined ? undefined : Math.round(n);
          })();
  if (candidate === undefined) return undefined;
  const parsed = schema.safeParse(candidate);
  return parsed.success ? (parsed.data as number | string | undefined) : undefined;
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Maps a form's answers by the source's field map. `givenAt` is when the form was sent. */
export function mapFormAnswers(
  answers: readonly FormAnswer[],
  mapping: SourceMapping,
  givenAt: string,
): MappedLead {
  const byTarget = new Map<IngestFieldTarget, string>();
  for (const answer of answers) {
    const target = mapping.fieldMap[answer.key];
    const value = clean(answer.value);
    if (target === undefined || value === '' || byTarget.has(target)) continue;
    byTarget.set(target, value);
  }

  const full = byTarget.get('fullName');
  const parts = [byTarget.get('firstName'), byTarget.get('lastName')].filter(
    (p): p is string => p !== undefined,
  );
  const name = (full ?? parts.join(' ')).slice(0, 120).trim();
  const rawPhone = byTarget.get('phone');
  const phone = rawPhone === undefined ? undefined : PhoneInputSchema.safeParse(rawPhone);
  const missing: ('name' | 'phone')[] = [];
  if (name === '') missing.push('name');
  if (phone?.success !== true) missing.push('phone');
  if (missing.length > 0 || phone?.success !== true) return { ok: false, missing };

  const pin = byTarget.get('pin')?.replace(/\s/g, '');
  const village = byTarget.get('village');
  const site = {
    ...(pin !== undefined && /^[1-9][0-9]{5}$/.test(pin) ? { pin } : {}),
    ...(village !== undefined && village.length >= 2 ? { village: village.slice(0, 120) } : {}),
  };

  const facts: Record<string, number | string> = {};
  for (const fact of FACT_TARGETS) {
    const raw = byTarget.get(fact);
    if (raw === undefined) continue;
    const value = factValue(fact, raw);
    if (value !== undefined) facts[fact] = value;
  }

  // A consent only when the mapped consent question was answered with a tick.
  const consentAnswer =
    mapping.consent === null
      ? undefined
      : answers.find((a) => a.key === mapping.consent?.questionKey);
  const consent =
    mapping.consent !== null && consentAnswer !== undefined && isTicked(consentAnswer.value)
      ? {
          channels: [...mapping.consent.channels],
          purpose: mapping.consent.purpose,
          textVersion: mapping.consent.textVersion,
          givenAt,
        }
      : undefined;

  const message = byTarget.get('message')?.slice(0, 1000);
  return {
    ok: true,
    contact: { name, phone: phone.data },
    site: Object.keys(site).length === 0 ? undefined : site,
    qualification:
      Object.keys(facts).length === 0 ? undefined : LeadQualificationFactsSchema.parse(facts),
    consent,
    message,
  };
}

/** The questions a form asked, for the field map's preview: keys and labels, never the answers. */
export function formQuestions(answers: readonly FormAnswer[]): { key: string; label: string | null }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string | null }[] = [];
  for (const a of answers) {
    const key = a.key.trim().slice(0, 200);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: a.label === null ? null : a.label.slice(0, 200) });
    if (out.length === 100) break;
  }
  return out;
}

/**
 * The idempotency key of a lead from an integration: a UUID made from the channel and the
 * provider's own id of the event, so the same event run twice is one lead whoever runs it.
 */
export function ingestIdempotencyKey(channel: string, externalId: string): string {
  const hex = createHash('sha256').update(`lead-ingest:${channel}:${externalId}`).digest('hex');
  // Version 8 (a custom UUID) and the RFC 4122 variant, so the key parses as a UUID.
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
