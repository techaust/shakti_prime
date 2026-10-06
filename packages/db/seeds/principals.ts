import {
  AGENT_PRINCIPAL_IDS,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type AgentRoleKey,
  type SystemRoleKey,
} from '@shakti/contracts';

/** One service principal per agent (docs/SECURITY.md §3.3). Users arrive with Better Auth. */
export const AGENT_PRINCIPAL_SEED: readonly {
  id: string;
  roleKey: AgentRoleKey;
  displayName: string;
}[] = [
  {
    id: AGENT_PRINCIPAL_IDS['agent:triage'],
    roleKey: 'agent:triage',
    displayName: 'Intake & Triage',
  },
  {
    id: AGENT_PRINCIPAL_IDS['agent:concierge'],
    roleKey: 'agent:concierge',
    displayName: 'WhatsApp Concierge',
  },
  {
    id: AGENT_PRINCIPAL_IDS['agent:copilot'],
    roleKey: 'agent:copilot',
    displayName: 'Caller Co-pilot',
  },
  {
    id: AGENT_PRINCIPAL_IDS['agent:sizing'],
    roleKey: 'agent:sizing',
    displayName: 'Sizing & Quote',
  },
  {
    id: AGENT_PRINCIPAL_IDS['agent:orchestrator'],
    roleKey: 'agent:orchestrator',
    displayName: 'Project Orchestrator',
  },
  {
    id: AGENT_PRINCIPAL_IDS['agent:chief'],
    roleKey: 'agent:chief',
    displayName: 'Chief of Staff',
  },
];

/** The system principal the event workers act as (docs/SECURITY.md §3.3). */
export const SYSTEM_PRINCIPAL_SEED: readonly {
  id: string;
  roleKey: SystemRoleKey;
  displayName: string;
}[] = [
  { id: SYSTEM_WORKERS_PRINCIPAL_ID, roleKey: 'system:workers', displayName: 'Event workers' },
];
