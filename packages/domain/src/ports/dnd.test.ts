import { describe, expect, it } from 'vitest';
import {
  DndRegistryUnavailable,
  FIXTURE_DND_NUMBERS,
  fixtureDndRegistry,
  unavailableDndRegistry,
} from './dnd';

describe('the DND register adapters', () => {
  it('the fixture lists its synthetic numbers and nothing else', async () => {
    const at = new Date('2026-11-13T05:30:00Z');
    const registry = fixtureDndRegistry({ now: () => at });
    const listed = FIXTURE_DND_NUMBERS[0] ?? '';
    expect(await registry.check(listed)).toEqual({ onDnd: true, checkedAt: at });
    expect(await registry.check('+919812345678')).toEqual({ onDnd: false, checkedAt: at });
    expect(registry.asked).toEqual([listed, '+919812345678']);
  });

  it('fails every lookup when unreachable, and when none is set up', async () => {
    await expect(
      fixtureDndRegistry({ unreachable: true }).check('+919812345678'),
    ).rejects.toBeInstanceOf(DndRegistryUnavailable);
    await expect(unavailableDndRegistry().check('+919812345678')).rejects.toBeInstanceOf(
      DndRegistryUnavailable,
    );
  });
});
