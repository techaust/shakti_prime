import type { SizingReason, SubsidyScheme } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { bounded, requireFinite, type Bounded } from './bounds';

/** One module line of a system: whether the item is DCR (`items.is_dcr`) and how many. */
export interface ModuleLine {
  readonly isDcr: boolean;
  readonly quantity: number;
}

export interface DcrRuleInput {
  readonly scheme: SubsidyScheme;
  readonly modules: readonly ModuleLine[];
  /** Schemes that require DCR modules (`WORKSHOP_DEFAULTS.sizing.dcrSchemes`). */
  readonly dcrSchemes?: readonly SubsidyScheme[];
}

export interface DcrRuleResult extends Bounded {
  /** The scheme requires DCR modules. */
  readonly required: boolean;
}

/**
 * The Domestic Content Requirement rule (BLUEPRINT §8.3): a system sold under a scheme that
 * requires DCR must carry modules, every one of them DCR. Fails with `no_modules` when the lines
 * hold no module and with `dcr_modules_required` when any module is not DCR. A scheme that does not
 * require DCR always passes.
 */
export function dcrRule({
  scheme,
  modules,
  dcrSchemes = WORKSHOP_DEFAULTS.sizing.dcrSchemes,
}: DcrRuleInput): DcrRuleResult {
  for (const line of modules) requireFinite('quantity', line.quantity);
  const required = dcrSchemes.includes(scheme);
  if (!required) return { required, ...bounded([]) };

  const counted = modules.filter((line) => line.quantity > 0);
  const reasons: SizingReason[] = [];
  if (counted.length === 0) reasons.push('no_modules');
  else if (counted.some((line) => !line.isDcr)) reasons.push('dcr_modules_required');
  return { required, ...bounded(reasons) };
}

export interface SanctionedLoadInput {
  /** Size of the system, in kWp. */
  readonly systemKw: number;
  /** Sanctioned load on the electricity connection, in kW. */
  readonly sanctionedLoadKw: number;
}

/**
 * The sanctioned-load rule (BLUEPRINT §8.3): a rooftop system may not exceed the connection's
 * sanctioned load (`sanctioned_load_exceeded`). The system's module size in kWp is compared, the
 * stricter reading, so no inverter choice can bring it back under. Floating-point noise below a
 * billionth of a kW is ignored.
 */
export function sanctionedLoadRule({ systemKw, sanctionedLoadKw }: SanctionedLoadInput): Bounded {
  requireFinite('systemKw', systemKw);
  requireFinite('sanctionedLoadKw', sanctionedLoadKw);
  return bounded(systemKw > sanctionedLoadKw + 1e-9 ? ['sanctioned_load_exceeded'] : []);
}
