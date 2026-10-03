import {
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
    id: '01990000-0000-7000-8000-000000000301',
    roleKey: 'agent:triage',
    displayName: 'Intake & Triage',
  },
  {
    id: '01990000-0000-7000-8000-000000000302',
    roleKey: 'agent:concierge',
    displayName: 'WhatsApp Concierge',
  },
  {
    id: '01990000-0000-7000-8000-000000000303',
    roleKey: 'agent:copilot',
    displayName: 'Caller Co-pilot',
  },
  {
    id: '01990000-0000-7000-8000-000000000304',
    roleKey: 'agent:sizing',
    displayName: 'Sizing & Quote',
  },
  {
    id: '01990000-0000-7000-8000-000000000305',
    roleKey: 'agent:orchestrator',
    displayName: 'Project Orchestrator',
  },
  {
    id: '01990000-0000-7000-8000-000000000306',
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
