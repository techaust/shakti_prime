import { describe, expect, it } from 'vitest';
import { dispositionPrecedence, pickEffective } from './pipeline-settings';

const row = (entityId: number | null, segment: 'farmer_pumps' | null, key: number) => ({
  entityId,
  segment,
  key,
});

describe('the call outcomes that apply', () => {
  it('go from the company and segment, to the company, to the group and segment, to the group', () => {
    expect(dispositionPrecedence(2, 'farmer_pumps')).toEqual([
      { entityId: 2, segment: 'farmer_pumps' },
      { entityId: 2, segment: null },
      { entityId: null, segment: 'farmer_pumps' },
      { entityId: null, segment: null },
    ]);
  });

  it('are the whole list of the most specific scope that has one, never a mix', () => {
    const group = [row(null, null, 1), row(null, null, 2)];
    const groupPumps = [row(null, 'farmer_pumps', 3)];
    const company = [row(2, null, 4), row(2, null, 5)];
    const companyPumps = [row(2, 'farmer_pumps', 6)];
    const all = [...group, ...groupPumps, ...company, ...companyPumps];
    expect(pickEffective(all, 2, 'farmer_pumps')?.rows).toEqual(companyPumps);
    expect(pickEffective([...group, ...groupPumps, ...company], 2, 'farmer_pumps')?.rows).toEqual(
      company,
    );
    expect(pickEffective([...group, ...groupPumps], 2, 'farmer_pumps')).toEqual({
      scope: { entityId: null, segment: 'farmer_pumps' },
      rows: groupPumps,
    });
    expect(pickEffective(group, 2, 'farmer_pumps')?.scope).toEqual({
      entityId: null,
      segment: null,
    });
    expect(pickEffective([], 2, 'farmer_pumps')).toBeUndefined();
  });

  it("ignore another company's list", () => {
    const other = [row(3, 'farmer_pumps', 7)];
    const group = [row(null, null, 1)];
    expect(pickEffective([...other, ...group], 2, 'farmer_pumps')?.rows).toEqual(group);
  });
});
