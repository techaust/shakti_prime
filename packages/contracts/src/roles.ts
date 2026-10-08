import { z } from 'zod';

/** Staff roles (docs/01-blueprint.md §7.1, docs/07-security.md §3.2). Executives can edit their grants. */
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

/** One service principal per AI agent, each with a fixed role (docs/07-security.md §3.3). */
export const AGENT_ROLE_KEYS = [
  'agent:triage',
  'agent:concierge',
  'agent:copilot',
  'agent:sizing',
  'agent:orchestrator',
  'agent:chief',
] as const;

/**
 * The system principal the event workers act as (docs/07-security.md §3.3): fixed grants, only what
 * its jobs need, never a cost, admin, audit, integrations or sensitive-document permission.
 */
export const SYSTEM_ROLE_KEYS = ['system:workers'] as const;

export const ROLE_KEYS = [...STAFF_ROLE_KEYS, ...AGENT_ROLE_KEYS, ...SYSTEM_ROLE_KEYS] as const;

export const StaffRoleKeySchema = z.enum(STAFF_ROLE_KEYS);
export const AgentRoleKeySchema = z.enum(AGENT_ROLE_KEYS);
export const SystemRoleKeySchema = z.enum(SYSTEM_ROLE_KEYS);
export const RoleKeySchema = z.enum(ROLE_KEYS);

export type StaffRoleKey = z.infer<typeof StaffRoleKeySchema>;
export type AgentRoleKey = z.infer<typeof AgentRoleKeySchema>;
export type SystemRoleKey = z.infer<typeof SystemRoleKeySchema>;
export type RoleKey = z.infer<typeof RoleKeySchema>;

export function isAgentRole(key: RoleKey): key is AgentRoleKey {
  return key.startsWith('agent:');
}

export function isSystemRole(key: RoleKey): key is SystemRoleKey {
  return key.startsWith('system:');
}

/** A staff role: neither an agent nor a system principal. */
export function isStaffRole(key: RoleKey): key is StaffRoleKey {
  return (STAFF_ROLE_KEYS as readonly string[]).includes(key);
}
