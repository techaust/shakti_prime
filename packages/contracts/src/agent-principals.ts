import type { PermissionGrant } from './permissions';
import type { AgentRoleKey } from './roles';

/**
 * The seeded service principal of each agent (`principals.kind = agent`, docs/SECURITY.md §3.3).
 * The seed writes these rows and the agent runtime acts as them, so the two cannot differ.
 */
export const AGENT_PRINCIPAL_IDS: Record<AgentRoleKey, string> = {
  'agent:triage': '01990000-0000-7000-8000-000000000301',
  'agent:concierge': '01990000-0000-7000-8000-000000000302',
  'agent:copilot': '01990000-0000-7000-8000-000000000303',
  'agent:sizing': '01990000-0000-7000-8000-000000000304',
  'agent:orchestrator': '01990000-0000-7000-8000-000000000305',
  'agent:chief': '01990000-0000-7000-8000-000000000306',
};

/**
 * What each agent principal holds (docs/SECURITY.md §3.3), limited to keys in the catalogue. The
 * seed writes these rows and the agent runtime builds its principal from the same list; no agent
 * ever holds a cost, admin or agent-control permission (the agent refusal sweep checks it).
 */
export const AGENT_MATRIX: Record<AgentRoleKey, readonly PermissionGrant[]> = {
  'agent:triage': [
    { key: 'crm.lead.read', scope: 'entity' },
    { key: 'crm.lead.write', scope: 'entity' },
    { key: 'crm.lead.assign', scope: 'entity' },
    { key: 'crm.lead.merge', scope: 'entity' },
  ],
  'agent:concierge': [
    { key: 'crm.lead.read', scope: 'own' },
    { key: 'crm.lead.write', scope: 'own' },
    { key: 'crm.account.read', scope: 'own' },
    { key: 'documents.write', scope: 'own' },
  ],
  'agent:copilot': [
    { key: 'crm.lead.read', scope: 'entity' },
    { key: 'crm.lead.write', scope: 'entity' },
    { key: 'knowledge.vault.read.staff', scope: 'all' },
  ],
  'agent:sizing': [
    { key: 'pricing.read', scope: 'entity' },
    { key: 'inventory.stock.read', scope: 'entity' },
    { key: 'sales.quote.create', scope: 'entity' },
  ],
  'agent:orchestrator': [
    { key: 'projects.read', scope: 'entity' },
    { key: 'projects.write', scope: 'entity' },
    { key: 'projects.schedule.write', scope: 'entity' },
    { key: 'documents.write', scope: 'entity' },
  ],
  'agent:chief': [
    { key: 'crm.lead.read', scope: 'entity' },
    { key: 'crm.account.read', scope: 'entity' },
    { key: 'projects.read', scope: 'entity' },
    { key: 'inventory.stock.read', scope: 'entity' },
  ],
};
