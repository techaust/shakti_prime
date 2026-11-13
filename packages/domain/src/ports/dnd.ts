/**
 * The DND register (TRAI's National Customer Preference Register), asked before a promotional
 * dial (BLUEPRINT §7.7, docs/03-roadmap-appendix/phase2.md §5.2). The scrub service is chosen with
 * the DLT registration in the final phase; until then the fixture adapter answers on development
 * and staging, and production has none, so every promotional dial whose check has gone stale is
 * refused (`dnd_unknown`) while a consented service call is never held up.
 */

/** What the register said about one number, and when it said it. */
export interface DndAnswer {
  onDnd: boolean;
  checkedAt: Date;
}

/** One lookup by an E.164 number. Throws `DndRegistryUnavailable` when it cannot answer. */
export interface DndRegistry {
  check(e164: string): Promise<DndAnswer>;
}

/** The register did not answer: down, slow, not set up, or not chosen yet. */
export class DndRegistryUnavailable extends Error {
  constructor(message = 'the DND register did not answer') {
    super(message);
    this.name = 'DndRegistryUnavailable';
  }
}

/**
 * The numbers the fixture register lists, clearly synthetic: the end-to-end journeys and the
 * tests use them for a customer on DND. Every other number is off the register.
 */
export const FIXTURE_DND_NUMBERS: readonly string[] = ['+919999000001', '+919999000002'];

/**
 * The register on development, staging and the tests: a fixed list, answering now. `unreachable`
 * makes every lookup fail, as an outage would.
 */
export function fixtureDndRegistry(
  options: { numbers?: Iterable<string>; unreachable?: boolean; now?: () => Date } = {},
): DndRegistry & { asked: string[] } {
  const listed = new Set(options.numbers ?? FIXTURE_DND_NUMBERS);
  const asked: string[] = [];
  const now = options.now ?? (() => new Date());
  return {
    asked,
    check(e164) {
      asked.push(e164);
      if (options.unreachable === true) return Promise.reject(new DndRegistryUnavailable());
      return Promise.resolve({ onDnd: listed.has(e164), checkedAt: now() });
    },
  };
}

/**
 * No register is set up on this runtime (production until the final phase, question 13): not an
 * outage, so the screens say the check is not set up rather than to try again.
 */
export class DndRegistryNotSetUp extends Error {
  constructor(message = 'no DND register is set up') {
    super(message);
    this.name = 'DndRegistryNotSetUp';
  }
}

/** No register at all (production until the final phase): every lookup is `DndRegistryNotSetUp`. */
export function unavailableDndRegistry(): DndRegistry {
  return { check: () => Promise.reject(new DndRegistryNotSetUp()) };
}
