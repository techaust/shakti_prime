import { PumpTypeSchema, type PumpType } from '@shakti/contracts';

/** What sizing reads of a catalogue pump's specifications (`items.specs_json`). */
export interface PumpSpecs {
  /** The pump set's rated output in HP (`hp`), or null when it is not given or unreadable. */
  readonly ratedHp: number | null;
  /** Where the pump sits (`pumpType`), or null when it is not given or unreadable. */
  readonly pumpType: PumpType | null;
}

/**
 * Reads a pump's rating and type from its specifications without trusting their shape: the
 * catalogue checks specifications by category when they are written, but a row written before
 * that check, or an item of another category, may hold anything. A rating that is not a finite
 * number above zero, or a type outside the pump types, reads as not given, so sizing skips the
 * check it feeds rather than judging on it.
 */
export function pumpSpecsOf(specs: unknown): PumpSpecs {
  const record =
    typeof specs === 'object' && specs !== null && !Array.isArray(specs)
      ? (specs as Record<string, unknown>)
      : {};
  const hp = record.hp;
  const type = PumpTypeSchema.safeParse(record.pumpType);
  return {
    ratedHp: typeof hp === 'number' && Number.isFinite(hp) && hp > 0 ? hp : null,
    pumpType: type.success ? type.data : null,
  };
}
