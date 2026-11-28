import { describe, expect, it } from 'vitest';
import { PROJECT_TABS, projectHref, projectTab, stepKeyFrom } from './projects';

describe('the project screens', () => {
  it('links a project by its company and id', () => {
    expect(projectHref(2, '01990000-0000-7000-8000-000000000001')).toBe(
      '/projects/2/01990000-0000-7000-8000-000000000001',
    );
  });

  it('opens the tab asked for, else the first', () => {
    expect(projectTab('milestones')).toBe('milestones');
    expect(projectTab('nothing')).toBe(PROJECT_TABS[0]);
    expect(projectTab(undefined)).toBe(PROJECT_TABS[0]);
  });

  it('makes a step key the database accepts, never one taken', () => {
    expect(stepKeyFrom('Net meter fitted', new Set())).toBe('net_meter_fitted');
    expect(stepKeyFrom('Net meter fitted', new Set(['net_meter_fitted']))).toBe(
      'net_meter_fitted_2',
    );
    expect(stepKeyFrom('2nd visit', new Set())).toBe('nd_visit');
    expect(stepKeyFrom('*** ###', new Set())).toBe('step');
    const key = stepKeyFrom('A'.repeat(90), new Set());
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
});
