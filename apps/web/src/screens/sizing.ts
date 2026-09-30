// The sizing panel's form and display rules (docs/design/phase1.md §6.7). Pure functions, so the
// panel and its tests share them; the calculators themselves run only on the server.

import type { SizingKind } from '@shakti/contracts';

/** The measurements of a pump sizing, in the order the panel asks for them. */
export const PUMP_MEASUREMENTS = [
  'staticLevelM',
  'drawdownM',
  'deliveryHeightM',
  'pipeLengthM',
  'pipeInnerDiameterMm',
  'flowLph',
] as const;

/** The measurements of a rooftop sizing. */
export const ROOFTOP_MEASUREMENTS = ['monthlyUnitsKwh', 'roofAreaSqm', 'sanctionedLoadKw'] as const;

/** The choices of a pump sizing. */
export const PUMP_CHOICES = ['pumpType', 'drive', 'pipeMaterial'] as const;

/**
 * The failure paths a field of the panel owns (`useFieldFailure`): a measurement the server
 * refuses is shown under its own field.
 */
export function sizingFields(kind: SizingKind): string[] {
  const names =
    kind === 'pump' ? [...PUMP_CHOICES, ...PUMP_MEASUREMENTS] : [...ROOFTOP_MEASUREMENTS];
  return [
    ...names.map((name) => `sizing.inputs.${name}`),
    ...(kind === 'pump' ? ['sizing.itemId'] : []),
  ];
}

/**
 * A typed number as the contract takes it: digits with an optional decimal point, in the
 * Indian grouping or none. An empty or unreadable field is left out, so the server names the
 * field that is missing rather than taking zero for it.
 */
export function measurement(typed: string): number | undefined {
  const plain = typed.trim().replaceAll(',', '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(plain)) return undefined;
  return Number(plain);
}

/** The `crm.sizing.record` input from the panel's fields, keyed by their names. */
export function buildSizingInput(
  kind: SizingKind,
  lead: { entityId: number; opportunityId: string },
  field: (name: string) => string,
): Record<string, unknown> {
  const numbers = (names: readonly string[]) =>
    Object.fromEntries(
      names.flatMap((name) => {
        const value = measurement(field(name));
        return value === undefined ? [] : [[name, value]];
      }),
    );
  if (kind === 'rooftop') {
    return { ...lead, sizing: { kind, inputs: numbers(ROOFTOP_MEASUREMENTS) } };
  }
  const choices = Object.fromEntries(PUMP_CHOICES.map((name) => [name, field(name)]));
  const itemId = field('itemId');
  return {
    ...lead,
    sizing: {
      kind,
      inputs: { ...choices, ...numbers(PUMP_MEASUREMENTS) },
      itemId: itemId === '' ? null : itemId,
    },
  };
}

/**
 * A quantity as the panel shows it, grouped the Indian way, with at most `digits` decimals and
 * no trailing zeros: 44.3948 m reads 44.39 m, 7.5 HP reads 7.5 HP, 18000 litres 18,000.
 */
export function formatQuantity(value: number, digits = 2): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
}

/**
 * The tab a key moves to in the panel's row of tabs (WAI-ARIA tabs, horizontal): the left and
 * right arrows step and wrap, Home and End jump to the ends; any other key leaves the tab where it
 * is (undefined).
 */
export function nextTab(current: number, key: string, count: number): number | undefined {
  if (count <= 0) return undefined;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}
