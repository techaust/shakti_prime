import { describe, expect, it } from 'vitest';
import { resolveAgentConfig, type AgentConfigRow } from './config';

// How agent settings apply (docs/design/phase1.md §7.1): a switch off at any level stops the agent;
// autonomy and the cap come from the most specific row that sets them; with none, Suggest and no cap.

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
      cap: null,
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
    expect(resolveAgentConfig(rows, 'agent:copilot', TASK, 1).autonomy).toBe('automatic');
    expect(resolveAgentConfig(rows.slice(0, 2), 'agent:copilot', TASK, 1).autonomy).toBe('suggest');
    expect(resolveAgentConfig(rows.slice(0, 2), 'agent:copilot', TASK, 2).autonomy).toBe(
      'needs_approval',
    );
  });

  it('takes the cap from the company row before the group row', () => {
    const rows = [row({ dailySpendCapPaise: 5000 }), row({ entityId: 1, dailySpendCapPaise: 200 })];
    expect(resolveAgentConfig(rows, 'agent:copilot', TASK, 1).cap).toEqual({
      paise: 200,
      entityId: 1,
    });
    expect(resolveAgentConfig(rows, 'agent:copilot', TASK, 2).cap).toEqual({
      paise: 5000,
      entityId: null,
    });
  });
});
