import {
  isStaleSizing,
  type Segment,
  type SizingDto,
  type SizingKind,
  type StaleSizingDto,
  type SubsidyScheme,
} from '@shakti/contracts';
import type { QuoteRecord } from '../state-machines/machines/quote';
import { dcrRule, sanctionedLoadRule, type ModuleLine } from './rules';

/** The three sizing facts the quote machine's guards read (`QuoteRecord`). */
export type QuoteSizingFacts = Pick<
  QuoteRecord,
  'sizingComplete' | 'pumpCurveInBounds' | 'dcrRuleMet'
>;

export interface QuoteSizingContext {
  /** The quote's segment (the lead's pipeline). */
  readonly segment: Segment;
  /** The pump item on the quote's lines, or null when it quotes none. */
  readonly quotedPumpItemId: string | null;
  /** The quote's solar module lines: whether each item is DCR and how many. */
  readonly moduleLines: readonly ModuleLine[];
  /** The subsidy scheme the quote is sold under. */
  readonly scheme: SubsidyScheme;
  /** The quote's module (DC) size, in kWp. */
  readonly systemKwp: number;
}

/** The kind of sizing a segment's quote relies on; the others rely on none. */
const SIZED_KIND: Partial<Record<Segment, SizingKind>> = {
  farmer_pumps: 'pump',
  residential_rooftop: 'rooftop',
};

/**
 * The sizing facts of a quote (docs/design/phase1.md §6.7, BLUEPRINT §8.3), from the lead's newest
 * sizing as `latestSizing` answers it and the quote's own lines, so every quote command fills the
 * quote machine's guards the same way:
 *
 * - `sizingComplete`: there is a sizing from today's engine (a stale one counts as none), it is in
 *   bounds, and it is of the kind the segment relies on (a pump for `farmer_pumps`, a rooftop for
 *   `residential_rooftop`; any kind for the segments that need no sizing, whose guard ignores it).
 * - `pumpCurveInBounds`: that sizing is a pump sizing with a duty point (a pump was chosen), the
 *   duty point is in bounds (on the curve, the flow within its band, the rating met), and the
 *   pump it was checked against is the pump the quote carries.
 * - `dcrRuleMet`: the DCR rule holds over the quote's module lines for its scheme, and the quote's
 *   kWp is within the sanctioned load the rooftop sizing recorded, at the ratio it was sized with.
 *   A rooftop quote with no current rooftop sizing has no sanctioned load to check against, so it
 *   fails; a quote of another segment with no rooftop sizing is held to the DCR rule alone.
 */
export function quoteSizingFacts(
  latest: SizingDto | StaleSizingDto | null,
  context: QuoteSizingContext,
): QuoteSizingFacts {
  const current = latest === null || isStaleSizing(latest) ? null : latest;
  const kind = SIZED_KIND[context.segment];

  const sizingComplete =
    current !== null && current.inBounds && (kind === undefined || current.kind === kind);

  const pumpCurveInBounds =
    current !== null &&
    current.kind === 'pump' &&
    current.result.dutyPoint !== null &&
    current.result.dutyPoint.inBounds &&
    context.quotedPumpItemId !== null &&
    current.itemId === context.quotedPumpItemId;

  const dcr = dcrRule({ scheme: context.scheme, modules: context.moduleLines });
  const sanctionedLoadMet =
    current !== null && current.kind === 'rooftop'
      ? sanctionedLoadRule({
          systemKw: context.systemKwp,
          sanctionedLoadKw: current.inputs.sanctionedLoadKw,
          ratio: current.result.constants.sanctionedLoadRatio,
        }).inBounds
      : context.segment !== 'residential_rooftop';

  return { sizingComplete, pumpCurveInBounds, dcrRuleMet: dcr.inBounds && sanctionedLoadMet };
}
