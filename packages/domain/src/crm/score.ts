import {
  ScoreMatchSchemas,
  type ScoreFactor,
  type ScoreReason,
  type Segment,
} from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/**
 * Rules-based lead scoring (CRM-06, workshop CRM-3). A pure function: the score is the base plus
 * the points of every rule that applies to the lead and matches it, held between 0 and 100. The
 * reasons list each matching rule's points in rule order, with the catalogue key that names its
 * factor on screen. An LLM never computes a score.
 */

/** What a rule can see of a lead. */
export interface ScoreFacts {
  entityId: number;
  segment: Segment;
  /** The code of the lead's source, when it has one. */
  sourceCode: string | null;
  /** The district of the lead's site, when recorded. */
  district: string | null;
  /** The system size from the lead's sizing, when recorded: kW for solar, HP for pumps. */
  systemSize: { kw: number | null; hp: number | null };
  createdAt: Date;
}

/** A stored rule (`lead_score_rules`). `match` is read here, never trusted. */
export interface ScoreRule {
  entityId: number | null;
  segment: Segment | null;
  factor: ScoreFactor;
  match: unknown;
  points: number;
}

export interface LeadScore {
  score: number;
  reasons: ScoreReason[];
}

const MIN = 0;
const MAX = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The catalogue key naming a factor, under `leads.score.reasons` in the messages. */
export function scoreReasonKey(factor: ScoreFactor): string {
  return `leads.score.reasons.${factor}`;
}

/** Whether a rule belongs to the lead's company (or the group) and segment (or every segment). */
export function ruleApplies(rule: ScoreRule, lead: ScoreFacts): boolean {
  return (
    (rule.entityId === null || rule.entityId === lead.entityId) &&
    (rule.segment === null || rule.segment === lead.segment)
  );
}

const norm = (text: string) => text.trim().toLowerCase();

function within(value: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

/** Whether the lead matches the rule's factor. A rule whose match cannot be read never matches. */
export function ruleMatches(rule: ScoreRule, lead: ScoreFacts, now: Date): boolean {
  switch (rule.factor) {
    case 'source': {
      const m = ScoreMatchSchemas.source.safeParse(rule.match);
      return (
        m.success &&
        lead.sourceCode !== null &&
        m.data.sourceCodes.some((code) => norm(code) === norm(lead.sourceCode ?? ''))
      );
    }
    case 'segment': {
      const m = ScoreMatchSchemas.segment.safeParse(rule.match);
      return m.success && m.data.segments.includes(lead.segment);
    }
    case 'district': {
      const m = ScoreMatchSchemas.district.safeParse(rule.match);
      const district = lead.district === null ? '' : norm(lead.district);
      return m.success && district !== '' && m.data.districts.some((d) => norm(d) === district);
    }
    case 'system_size': {
      const m = ScoreMatchSchemas.system_size.safeParse(rule.match);
      if (!m.success) return false;
      const size = m.data.unit === 'kw' ? lead.systemSize.kw : lead.systemSize.hp;
      return size !== null && within(size, m.data.min, m.data.max);
    }
    case 'age_days': {
      const m = ScoreMatchSchemas.age_days.safeParse(rule.match);
      if (!m.success) return false;
      const age = Math.max(0, Math.floor((now.getTime() - lead.createdAt.getTime()) / DAY_MS));
      return within(age, m.data.minDays, m.data.maxDays);
    }
  }
}

export function scoreLead(lead: ScoreFacts, rules: readonly ScoreRule[], now: Date): LeadScore {
  const reasons: ScoreReason[] = [];
  let total = WORKSHOP_DEFAULTS.crm.scoreBase;
  for (const rule of rules) {
    if (!ruleApplies(rule, lead) || !ruleMatches(rule, lead, now)) continue;
    total += rule.points;
    reasons.push({
      factor: rule.factor,
      points: rule.points,
      labelKey: scoreReasonKey(rule.factor),
    });
  }
  return { score: Math.min(MAX, Math.max(MIN, total)), reasons };
}
