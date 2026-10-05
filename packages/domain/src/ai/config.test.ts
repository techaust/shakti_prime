import { describe, expect, it } from 'vitest';
import { appliedAutonomy, resolveAgentConfig, type AgentConfigRow } from './config';

// How agent settings apply (docs/design/phase1.md §7.1): a switch off at any level stops the agent;
// autonomy comes from the most specific row that sets it; the company's and the group's caps both
// apply; with none, Suggest and no cap.

const row = (over: Partial<AgentConfigRow>): AgentConfigRow => ({
  agent: 'agent:copilot',
  actionType: null,
  entityId: null,
  autonomy: null,
  dailySpendCapPaise: null,
  enabled: true,
  ...over,
});

const TASK = 'crm.task.create';

describe('resolveAgentConfig', () => {
  it('suggests, with no cap, when nothing is set', () => {
    expect(resolveAgentConfig([], 'agent:copilot', TASK, 1)).toEqual({
      enabled: true,
      autonomy: 'suggest',
      autonomySource: 'default',
      caps: [],
    });
  });

  it('is stopped by a switch off for every agent, the agent, or the company', () => {
    const every = row({ agent: null, enabled: false });
    const agent = row({ enabled: false });
    const company = row({ entityId: 1, enabled: false });
    for (const off of [every, agent, company]) {
      expect(resolveAgentConfig([off], 'agent:copilot', TASK, 1).enabled).toBe(false);
    }
    // A company's own switch on does not undo the group's switch off.
    expect(
      resolveAgentConfig([every, row({ entityId: 1, enabled: true })], 'agent:copilot', TASK, 1)
        .enabled,
    ).toBe(false);
    // Another company's, or another agent's, switch does not stop it.
    expect(
      resolveAgentConfig(
        [row({ entityId: 2, enabled: false }), row({ agent: 'agent:triage', enabled: false })],
        'agent:copilot',
        TASK,
        1,
      ).enabled,
    ).toBe(true);
  });

  it('takes autonomy from the most specific row: action type, then company', () => {
    const rows = [
      row({ autonomy: 'needs_approval' }),
      row({ entityId: 1, autonomy: 'suggest' }),
      row({ actionType: TASK, autonomy: 'automatic' }),
    ];
    expect(resolveAgentConfig(rows, 'agent:copilot', TASK, 1)).toMatchObject({
      autonomy: 'automatic',
      autonomySource: 'action_group',
    });
    expect(resolveAgentConfig(rows.slice(0, 2), 'agent:copilot', TASK, 1).autonomy).toBe('suggest');
    expect(resolveAgentConfig(rows.slice(0, 2), 'agent:copilot', TASK, 2).autonomy).toBe(
      'needs_approval',
    );
  });

  it('applies the company’s cap and the group’s cap both', () => {
    const rows = [row({ dailySpendCapPaise: 5000 }), row({ entityId: 1, dailySpendCapPaise: 200 })];
    expect(resolveAgentConfig(rows, 'agent:copilot', TASK, 1).caps).toEqual([
      { paise: 200, entityId: 1 },
      { paise: 5000, entityId: null },
    ]);
    expect(resolveAgentConfig(rows, 'agent:copilot', TASK, 2).caps).toEqual([
      { paise: 5000, entityId: null },
    ]);
    expect(resolveAgentConfig(rows.slice(1), 'agent:copilot', TASK, 1).caps).toEqual([
      { paise: 200, entityId: 1 },
    ]);
  });

  it('names where the autonomy comes from', () => {
    expect(
      appliedAutonomy([row({ entityId: 1, autonomy: 'needs_approval' })], 'agent:copilot', TASK, 1),
    ).toEqual({ autonomy: 'needs_approval', source: 'agent_company' });
    expect(
      appliedAutonomy(
        [row({ actionType: TASK, entityId: 1, autonomy: 'suggest' })],
        'agent:copilot',
        TASK,
        1,
      ),
    ).toEqual({ autonomy: 'suggest', source: 'action_company' });
    expect(
      appliedAutonomy([row({ autonomy: 'needs_approval' })], 'agent:copilot', TASK, 1),
    ).toEqual({ autonomy: 'needs_approval', source: 'agent_group' });
  });
});
