import { bounded, ceilCount, requireFinite, type Bounded } from './bounds';

export interface SolarPumpInput {
  /** Rated output of the chosen motor, in kW (`pumpPower().standardKw`). */
  readonly motorKw: number;
  /** Array size over the motor rating, covering heat, dust and morning and evening sun (1.3 = 30% more). */
  readonly arrayOversize: number;
  /** Watt-peak of one module. */
  readonly moduleWp: number;
}

export interface SolarPumpResult extends Bounded {
  /** Array size the motor needs: its rating times the oversize, in kWp. */
  readonly requiredKwp: number;
  /** Whole modules that reach the required size. */
  readonly moduleCount: number;
  /** Size of that many modules, in kWp (at or above the required size). */
  readonly arrayKwp: number;
}

/**
 * The solar array for a pump: the motor rating times the oversize, rounded up to whole modules.
 * Always in bounds; the DCR rule for the modules is checked on the quote (`dcrRule`).
 */
export function solarArrayForPump(input: SolarPumpInput): SolarPumpResult {
  requireFinite('motorKw', input.motorKw);
  requireFinite('arrayOversize', input.arrayOversize, { positive: true });
  requireFinite('moduleWp', input.moduleWp, { positive: true });

  const requiredKwp = input.motorKw * input.arrayOversize;
  const moduleCount = ceilCount((requiredKwp * 1000) / input.moduleWp);
  return {
    requiredKwp,
    moduleCount,
    arrayKwp: (moduleCount * input.moduleWp) / 1000,
    ...bounded([]),
  };
}
