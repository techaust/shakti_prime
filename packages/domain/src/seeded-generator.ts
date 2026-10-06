/**
 * A seeded random generator (mulberry32) for the property tests: each run draws the same cases, so
 * a failure names a case that repeats. Test support only; nothing in the domain draws at random.
 */
export function seededGenerator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    between: (min: number, max: number): number => min + next() * (max - min),
    int: (min: number, max: number): number => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T,
    chance: (): boolean => next() < 0.5,
  };
}

export type SeededGenerator = ReturnType<typeof seededGenerator>;

/** Runs `check` on `runs` cases drawn from one seeded generator. */
export function forAllSeeded(
  seed: number,
  runs: number,
  check: (random: SeededGenerator) => void,
): void {
  const random = seededGenerator(seed);
  for (let run = 0; run < runs; run += 1) check(random);
}
