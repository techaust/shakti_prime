import type { RooftopBound, SizingReason } from '@shakti/contracts';
import {
  bounded,
  ceilCount,
  floorCount,
  requireFinite,
  requireFraction,
  type Bounded,
} from './bounds';

export interface RooftopInput {
  /** Average monthly consumption from the electricity bills, in kWh (units). */
  readonly monthlyUnitsKwh: number;
  /** Peak sun hours a day at the site (kWh per m² per day). */
  readonly peakSunHours: number;
  /** Share of the modules' rated output that reaches the meter, above 0 and at most 1. */
  readonly performanceRatio: number;
  /** Shade-free roof area, in square metres. */
  readonly roofAreaSqm: number;
  /** Roof area one kWp of modules takes, in square metres. */
  readonly areaPerKwSqm: number;
  /** Sanctioned load on the electricity connection, in kW. */
  readonly sanctionedLoadKw: number;
  /**
   * The DC kWp allowed per kW of sanctioned load (`WORKSHOP_DEFAULTS.sizing.sanctionedLoadRatio`):
   * the same ratio `sanctionedLoadRule` checks a quote against.
   */
  readonly sanctionedLoadRatio: number;
  /** Watt-peak of one module. */
  readonly moduleWp: number;
}

export interface RooftopResult extends Bounded {
  /** Size that covers the consumption: daily units over sun hours times the performance ratio, in kWp. */
  readonly neededKwp: number;
  /** Size the roof holds: area over the area per kWp, in kWp. */
  readonly roofKwp: number;
  /** Size the sanctioned load allows: the load times the ratio, in kWp. */
  readonly sanctionedKwp: number;
  /** Whole modules recommended. */
  readonly moduleCount: number;
  /** Size of those modules, in kWp. */
  readonly recommendedKwp: number;
  /** The limit that set the recommendation. */
  readonly boundBy: RooftopBound;
}

/**
 * Rooftop size from consumption. The need is the average daily units (monthly units · 12 / 365)
 * over the peak sun hours times the performance ratio, rounded up to whole modules; the roof and
 * the sanctioned load each cap it, rounded down to whole modules. The recommendation is the
 * smallest of the three and `boundBy` names which one set it (the need wins a tie, since it is
 * met). Out of bounds when there is no consumption (`no_consumption`) or when not one module
 * fits the limit that binds (`roof_too_small`, `sanctioned_load_too_small`).
 */
export function rooftopSize(input: RooftopInput): RooftopResult {
  requireFinite('monthlyUnitsKwh', input.monthlyUnitsKwh);
  requireFinite('peakSunHours', input.peakSunHours, { positive: true });
  requireFraction('performanceRatio', input.performanceRatio);
  requireFinite('roofAreaSqm', input.roofAreaSqm);
  requireFinite('areaPerKwSqm', input.areaPerKwSqm, { positive: true });
  requireFinite('sanctionedLoadKw', input.sanctionedLoadKw);
  requireFinite('sanctionedLoadRatio', input.sanctionedLoadRatio, { positive: true });
  requireFinite('moduleWp', input.moduleWp, { positive: true });

  const dailyUnits = (input.monthlyUnitsKwh * 12) / 365;
  const neededKwp = dailyUnits / (input.peakSunHours * input.performanceRatio);
  const roofKwp = input.roofAreaSqm / input.areaPerKwSqm;
  const sanctionedKwp = input.sanctionedLoadKw * input.sanctionedLoadRatio;

  const modulesFor = (kwp: number): number => (kwp * 1000) / input.moduleWp;
  const limits: readonly { bound: RooftopBound; modules: number }[] = [
    { bound: 'need', modules: ceilCount(modulesFor(neededKwp)) },
    { bound: 'roof', modules: floorCount(modulesFor(roofKwp)) },
    { bound: 'sanctioned_load', modules: floorCount(modulesFor(sanctionedKwp)) },
  ];
  const binding = limits.reduce((least, limit) => (limit.modules < least.modules ? limit : least));

  const reasons: SizingReason[] = [];
  if (input.monthlyUnitsKwh === 0) reasons.push('no_consumption');
  else if (binding.modules === 0) {
    reasons.push(binding.bound === 'roof' ? 'roof_too_small' : 'sanctioned_load_too_small');
  }

  return {
    neededKwp,
    roofKwp,
    sanctionedKwp,
    moduleCount: binding.modules,
    recommendedKwp: (binding.modules * input.moduleWp) / 1000,
    boundBy: binding.bound,
    ...bounded(reasons),
  };
}
