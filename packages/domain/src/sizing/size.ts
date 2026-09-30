import type {
  PumpSizingInputs,
  PumpSizingResult,
  RooftopSizingInputs,
  RooftopSizingResult,
  SizingReason,
} from '@shakti/contracts';
import { WORKSHOP_DEFAULTS, type SizingDefaults } from '../workshop-defaults';
import type { Bounded } from './bounds';
import { pumpDutyPoint, type CurvePoint } from './duty-point';
import { totalDynamicHead } from './head';
import { pumpPower } from './power';
import { rooftopSize } from './rooftop';
import { solarArrayForPump } from './solar-pump';

/**
 * The version of the sizing engine a stored result came from (`sizings.engine_version`). Raise it
 * whenever a calculator or the way results are combined changes, so an old result is never
 * mistaken for one today's engine would give.
 */
export const SIZING_ENGINE_VERSION = '1';

/** Every reason of the parts, once each, in the order they arose. */
function combine(parts: readonly (Bounded | null)[]): Bounded {
  const reasons = [...new Set(parts.flatMap((part) => part?.reasons ?? []))] as SizingReason[];
  return { inBounds: reasons.length === 0, reasons };
}

/** A catalogue pump a sizing is checked against: its curve and its rated HP, if given. */
export interface ChosenPump {
  readonly curve: readonly CurvePoint[];
  /** The pump set's rated output from its specifications (`hp`); null when not given. */
  readonly ratedHp: number | null;
}

/**
 * A pump sizing from the field measurements: TDH, then the power and standard HP at the
 * efficiencies for the pump type, the solar array for a solar drive, and the duty point on the
 * chosen pump's curve when one is given. In bounds only when every part is.
 */
export function sizePump(
  inputs: PumpSizingInputs,
  pump: ChosenPump | null,
  defaults: SizingDefaults = WORKSHOP_DEFAULTS.sizing,
): { result: PumpSizingResult } & Bounded {
  const efficiency = defaults.efficiency[inputs.pumpType];
  const solarDrive = inputs.drive === 'solar';
  const constants = {
    hazenWilliamsC: defaults.hazenWilliamsC[inputs.pipeMaterial],
    fittingsLossFraction: defaults.fittingsLossFraction,
    pumpEfficiency: efficiency.pump,
    motorEfficiency: efficiency.motor,
    standardHp: [...defaults.standardHp],
    arrayOversize: solarDrive ? defaults.solarArrayOversize : null,
    moduleWp: solarDrive ? defaults.moduleWp : null,
  };

  const head = totalDynamicHead({
    staticLevelM: inputs.staticLevelM,
    drawdownM: inputs.drawdownM,
    deliveryHeightM: inputs.deliveryHeightM,
    pipeLengthM: inputs.pipeLengthM,
    pipeInnerDiameterMm: inputs.pipeInnerDiameterMm,
    flowLph: inputs.flowLph,
    fittingsLossFraction: constants.fittingsLossFraction,
    hazenWilliamsC: constants.hazenWilliamsC,
  });
  const power = pumpPower({
    flowLph: inputs.flowLph,
    tdhM: head.tdhM,
    pumpEfficiency: constants.pumpEfficiency,
    motorEfficiency: constants.motorEfficiency,
    standardHp: constants.standardHp,
  });
  // A solar array is sized for the standard motor; above the largest rating there is none to size.
  const solar =
    solarDrive && power.standardKw !== null
      ? solarArrayForPump({
          motorKw: power.standardKw,
          arrayOversize: defaults.solarArrayOversize,
          moduleWp: defaults.moduleWp,
        })
      : null;
  const dutyPoint = pump === null ? null : pumpDutyPoint(pump.curve, head.tdhM);

  return {
    result: {
      kind: 'pump',
      constants,
      head: { ...head, reasons: [...head.reasons] },
      power: { ...power, reasons: [...power.reasons] },
      solar: solar && { ...solar, reasons: [...solar.reasons] },
      dutyPoint: dutyPoint && { ...dutyPoint, reasons: [...dutyPoint.reasons] },
    },
    ...combine([head, power, solar, dutyPoint]),
  };
}

/** A rooftop sizing from the bills, the roof and the sanctioned load, at the default constants. */
export function sizeRooftop(
  inputs: RooftopSizingInputs,
  defaults: SizingDefaults = WORKSHOP_DEFAULTS.sizing,
): { result: RooftopSizingResult } & Bounded {
  const constants = {
    peakSunHours: defaults.peakSunHours,
    performanceRatio: defaults.performanceRatio,
    roofAreaPerKwSqm: defaults.roofAreaPerKwSqm,
    moduleWp: defaults.moduleWp,
  };
  const rooftop = rooftopSize({
    monthlyUnitsKwh: inputs.monthlyUnitsKwh,
    roofAreaSqm: inputs.roofAreaSqm,
    sanctionedLoadKw: inputs.sanctionedLoadKw,
    peakSunHours: constants.peakSunHours,
    performanceRatio: constants.performanceRatio,
    areaPerKwSqm: constants.roofAreaPerKwSqm,
    moduleWp: constants.moduleWp,
  });
  return {
    result: { kind: 'rooftop', constants, rooftop: { ...rooftop, reasons: [...rooftop.reasons] } },
    ...combine([rooftop]),
  };
}
