import { z } from 'zod';

/** Staff roles (docs/BLUEPRINT.md §7.1, docs/SECURITY.md §3.2). Executives can edit their grants. */
export const STAFF_ROLE_KEYS = [
  'executive',
  'general_manager',
  'sales_team_lead',
  'tele_caller_cc',
  'tele_caller_lc',
  'store_manager',
  'inventory_manager',
  'project_manager',
  'field_engineer',
  'accounts',
  'hr_admin',
] as const;

/** One service principal per AI agent, each with a fixed role (docs/SECURITY.md §3.3). */
export const AGENT_ROLE_KEYS = [
  'agent:triage',
  'agent:concierge',
  'agent:copilot',
  'agent:sizing',
  'agent:orchestrator',
  'agent:chief',
] as const;

export const ROLE_KEYS = [...STAFF_ROLE_KEYS, ...AGENT_ROLE_KEYS] as const;

export const StaffRoleKeySchema = z.enum(STAFF_ROLE_KEYS);
export const AgentRoleKeySchema = z.enum(AGENT_ROLE_KEYS);
export const RoleKeySchema = z.enum(ROLE_KEYS);

export type StaffRoleKey = z.infer<typeof StaffRoleKeySchema>;
export type AgentRoleKey = z.infer<typeof AgentRoleKeySchema>;
export type RoleKey = z.infer<typeof RoleKeySchema>;

export function isAgentRole(key: RoleKey): key is AgentRoleKey {
  return key.startsWith('agent:');
}
