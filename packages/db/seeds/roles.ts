import type { RoleKey } from '@shakti/contracts';

/** Role ids are fixed so seeds are idempotent and tests can reference them. */
export const ROLE_SEED: readonly { id: string; key: RoleKey; name: string }[] = [
  {
    id: '01990000-0000-7000-8000-000000000101',
    key: 'executive',
    name: 'Executive',
  },
  {
    id: '01990000-0000-7000-8000-000000000102',
    key: 'general_manager',
    name: 'General Manager',
  },
  {
    id: '01990000-0000-7000-8000-000000000103',
    key: 'sales_team_lead',
    name: 'Sales Team Lead',
  },
  {
    id: '01990000-0000-7000-8000-000000000104',
    key: 'tele_caller_cc',
    name: 'Tele-Caller (Cold Calling)',
  },
  {
    id: '01990000-0000-7000-8000-000000000105',
    key: 'tele_caller_lc',
    name: 'Tele-Caller (Lead Conversion)',
  },
  {
    id: '01990000-0000-7000-8000-000000000106',
    key: 'store_manager',
    name: 'Store Manager',
  },
  {
    id: '01990000-0000-7000-8000-000000000107',
    key: 'inventory_manager',
    name: 'Inventory Manager',
  },
  {
    id: '01990000-0000-7000-8000-000000000108',
    key: 'project_manager',
    name: 'Project Manager',
  },
  {
    id: '01990000-0000-7000-8000-000000000109',
    key: 'field_engineer',
    name: 'Field Engineer',
  },
  {
    id: '01990000-0000-7000-8000-000000000110',
    key: 'accounts',
    name: 'Accounts',
  },
  {
    id: '01990000-0000-7000-8000-000000000111',
    key: 'hr_admin',
    name: 'HR Admin',
  },
  {
    id: '01990000-0000-7000-8000-000000000201',
    key: 'agent:triage',
    name: 'Intake & Triage agent',
  },
  {
    id: '01990000-0000-7000-8000-000000000202',
    key: 'agent:concierge',
    name: 'WhatsApp Concierge agent',
  },
  {
    id: '01990000-0000-7000-8000-000000000203',
    key: 'agent:copilot',
    name: 'Caller Co-pilot agent',
  },
  {
    id: '01990000-0000-7000-8000-000000000204',
    key: 'agent:sizing',
    name: 'Sizing & Quote agent',
  },
  {
    id: '01990000-0000-7000-8000-000000000205',
    key: 'agent:orchestrator',
    name: 'Project Orchestrator agent',
  },
  {
    id: '01990000-0000-7000-8000-000000000206',
    key: 'agent:chief',
    name: 'Chief of Staff agent',
  },
];

export function roleId(key: RoleKey): string {
  const row = ROLE_SEED.find((r) => r.key === key);
  if (!row) throw new Error(`no seeded role for ${key}`);
  return row.id;
}
