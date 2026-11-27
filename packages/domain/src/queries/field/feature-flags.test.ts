import { describe, expect, it } from 'vitest';
import { resolveFeatureFlags } from './feature-flags';

describe('resolveFeatureFlags', () => {
  const rows = [
    { key: 'field.map', entityId: null, enabled: false },
    { key: 'field.map', entityId: 2, enabled: true },
    { key: 'field.qc_signature', entityId: null, enabled: true },
    { key: 'field.qc_signature', entityId: 1, enabled: false },
    { key: 'field.offline_surveys', entityId: 3, enabled: true },
  ];

  it("takes a company's own row over the group's, and the group's where it has none", () => {
    expect(resolveFeatureFlags(rows, [1])).toEqual({
      'field.map': false,
      'field.offline_surveys': false,
      'field.qc_signature': false,
    });
    expect(resolveFeatureFlags(rows, [2])).toEqual({
      'field.map': true,
      'field.offline_surveys': false,
      'field.qc_signature': true,
    });
  });

  it('has a flag on for a person when any of their companies has it on', () => {
    expect(resolveFeatureFlags(rows, [1, 2, 3])).toEqual({
      'field.map': true,
      'field.offline_surveys': true,
      'field.qc_signature': true,
    });
  });

  it('answers no flags without rows, and every flag off without companies', () => {
    expect(resolveFeatureFlags([], [1])).toEqual({});
    expect(resolveFeatureFlags(rows, [])).toEqual({
      'field.map': false,
      'field.offline_surveys': false,
      'field.qc_signature': false,
    });
  });
});
