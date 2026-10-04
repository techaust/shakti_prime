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
import { pumpMatch } from './match';
import { pumpPower, type PowerResult } from './power';
import { rooftopSize } from './rooftop';
import { solarArrayForPump } from './solar-pump';
import { suctionLift } from './suction';

/**
 * The version of the sizing engine a stored result came from (`sizings.engine_version`). Raise it
 * whenever a calculator or the way results are combined changes, so an old result is never
 * mistaken for one today's engine would give.
 */
export const SIZING_ENGINE_VERSION = '2';

/** Every reason of the parts, once each, in the order they arose. */
function combine(parts: readonly (Bounded | null)[]): Bounded {
  const reasons = [...new Set(parts.flatMap((part) => part?.reasons ?? []))] as SizingReason[];
  return { inBounds: reasons.length === 0, reasons };
}

/**
 * The chosen pump at the sized duty: where its curve puts it (`pumpDutyPoint`) and whether it
 * suits the site (`pumpMatch`: its flow against the needed flow, its rating against the sized
 * one), as one part with the reasons of both.
 */
function chosenPumpAtDuty(
  pump: ChosenPump,
  inputs: PumpSizingInputs,
  tdhM: number,
  power: PowerResult,
  constants: { dutyFlowTolerance: number; dutyFlowOvershootFactor: number },
): NonNullable<PumpSizingResult['dutyPoint']> {
  const onCurve = pumpDutyPoint(pump.curve, tdhM);
  const match = pumpMatch({
    dutyFlowLph: onCurve.dutyFlowLph,
    requiredFlowLph: inputs.flowLph,
    ratedHp: pump.ratedHp,
    sizedHp: power.standardHp,
    dutyFlowTolerance: constants.dutyFlowTolerance,
    dutyFlowOvershootFactor: constants.dutyFlowOvershootFactor,
  });
  const { inBounds, reasons } = combine([onCurve, match]);
  return {
    dutyFlowLph: onCurve.dutyFlowLph,
    shutoffHeadM: onCurve.shutoffHeadM,
    minHeadM: onCurve.minHeadM,
    requiredFlowLph: match.requiredFlowLph,
    minFlowLph: match.minFlowLph,
    maxFlowLph: match.maxFlowLph,
    ratedHp: match.ratedHp,
    inBounds,
    reasons: [...reasons],
  };
}

/** A catalogue pump a sizing is checked against: its curve and its rated HP, if given. */
export interface ChosenPump {
  readonly curve: readonly CurvePoint[];
  /** The pump set's rated output from its specifications (`hp`); null when not given. */
  readonly ratedHp: number | null;
}

/**
 * A pump sizing from the field measurements: TDH, the suction lift of a surface pump, then the
 * power and standard HP at the efficiencies for the pump type, the solar array for a solar drive,
 * and the duty point on the chosen pump's curve when one is given. In bounds only when every
 * part is.
 */
export function sizePump(
  inputs: PumpSizingInputs,
  pump: ChosenPump | null,
  defaults: SizingDefaults = WORKSHOP_DEFAULTS.sizing,
): { result: PumpSizingResult } & Bounded {
  const efficiency = defaults.efficiency[inputs.pumpType];
  const solarDrive = inputs.drive === 'solar';
  const surface = inputs.pumpType === 'surface';
  const constants = {
    hazenWilliamsC: defaults.hazenWilliamsC[inputs.pipeMaterial],
    fittingsLossFraction: defaults.fittingsLossFraction,
    pumpEfficiency: efficiency.pump,
    motorEfficiency: efficiency.motor,
    motorMarginFraction: defaults.motorMarginFraction,
    standardHp: [...defaults.standardHp],
    dutyFlowTolerance: defaults.dutyFlowTolerance,
    dutyFlowOvershootFactor: defaults.dutyFlowOvershootFactor,
    maxPipeVelocityMps: defaults.maxPipeVelocityMps,
    maxSuctionLiftM: surface ? defaults.surfaceMaxSuctionLiftM : null,
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
    maxPipeVelocityMps: constants.maxPipeVelocityMps,
  });
  // A surface pump draws the water up to itself; a submersible sits in it.
  const suction = surface
    ? suctionLift({
        staticLevelM: inputs.staticLevelM,
        drawdownM: inputs.drawdownM,
        maxSuctionLiftM: defaults.surfaceMaxSuctionLiftM,
      })
    : null;
  const power = pumpPower({
    flowLph: inputs.flowLph,
    tdhM: head.tdhM,
    pumpEfficiency: constants.pumpEfficiency,
    motorEfficiency: constants.motorEfficiency,
    motorMarginFraction: constants.motorMarginFraction,
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
  const dutyPoint =
    pump === null ? null : chosenPumpAtDuty(pump, inputs, head.tdhM, power, constants);

  return {
    result: {
      kind: 'pump',
      constants,
      head: { ...head, reasons: [...head.reasons], advisories: [...head.advisories] },
      power: { ...power, reasons: [...power.reasons] },
      suction: suction && { ...suction, reasons: [...suction.reasons] },
      solar: solar && { ...solar, reasons: [...solar.reasons] },
      dutyPoint,
      // Only the head gives advice so far; it never enters the reasons or the bounds.
      advisories: [...head.advisories],
    },
    ...combine([head, suction, power, solar, dutyPoint]),
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
    sanctionedLoadRatio: defaults.sanctionedLoadRatio,
    moduleWp: defaults.moduleWp,
  };
  const rooftop = rooftopSize({
    monthlyUnitsKwh: inputs.monthlyUnitsKwh,
    roofAreaSqm: inputs.roofAreaSqm,
    sanctionedLoadKw: inputs.sanctionedLoadKw,
    sanctionedLoadRatio: constants.sanctionedLoadRatio,
    peakSunHours: constants.peakSunHours,
    performanceRatio: constants.performanceRatio,
    areaPerKwSqm: constants.roofAreaPerKwSqm,
    moduleWp: constants.moduleWp,
  });
  return {
    result: {
      kind: 'rooftop',
      constants,
      rooftop: { ...rooftop, reasons: [...rooftop.reasons] },
      advisories: [],
    },
    ...combine([rooftop]),
  };
}
