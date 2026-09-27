import { type CompositeRuleRow, DomainError, type Segment } from '@shakti/contracts';
import { divideHalfUp, toScaled } from '../money/paise';
import { istCalendarDate } from '../numbering/financial-year';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { effectiveOn } from './resolve-rate';

export interface CompositeQuery {
  segment: Segment;
  /** The line is flagged as a works contract (supply and installation as one contract). */
  worksContract: boolean;
  on: Date;
}

/**
 * The composite-supply rule for a line, or null when the line is taxed at its own rate. Only
 * works-contract lines in the segments of `WORKSHOP_DEFAULTS.tax.compositeSegments` are
 * composite; such a line with no effective rule is refused rather than taxed at a guessed rate.
 */
export function resolveCompositeRule(
  rules: readonly CompositeRuleRow[],
  query: CompositeQuery,
): CompositeRuleRow | null {
  if (!query.worksContract || !WORKSHOP_DEFAULTS.tax.compositeSegments.includes(query.segment)) {
    return null;
  }
  const day = istCalendarDate(query.on);
  const live = rules.filter((rule) => rule.segment === query.segment && effectiveOn(rule, day));
  if (live.length > 1) throw new DomainError('internal', 'composite rules overlap');
  const [rule] = live;
  if (!rule) {
    throw new DomainError('validation_failed', `no composite rule on ${day}`, {
      reason: 'composite_rule_missing',
      segment: query.segment,
      day,
    });
  }
  return rule;
}

export interface CompositeParts {
  goodsTaxable: bigint;
  servicesTaxable: bigint;
  /** Rates in hundredths of a percent: `12.00` → 1200. */
  goodsRateBp: bigint;
  servicesRateBp: bigint;
}

/**
 * Splits a line's taxable value by the rule's shares (solar 70:30). The goods part rounds half-up
 * to the paisa and the services part is the remainder, so the parts always sum to the whole.
 */
export function compositeSplit(rule: CompositeRuleRow, taxablePaise: bigint): CompositeParts {
  const goodsShareBp = toScaled(rule.goodsSharePct, 2);
  const goodsTaxable = divideHalfUp(taxablePaise * goodsShareBp, 10_000n);
  return {
    goodsTaxable,
    servicesTaxable: taxablePaise - goodsTaxable,
    goodsRateBp: toScaled(rule.goodsRatePct, 2),
    servicesRateBp: toScaled(rule.servicesRatePct, 2),
  };
}
