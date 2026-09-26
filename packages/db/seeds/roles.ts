import type { RoleKey } from '@shakti/contracts';

/** Role ids are fixed so seeds are idempotent and tests can reference them. */
export const ROLE_SEED: readonly { id: string; key: RoleKey; name: string; nameHi: string }[] = [
  {
    id: '01990000-0000-7000-8000-000000000101',
    key: 'executive',
    name: 'Executive',
    nameHi: 'एग्ज़ीक्यूटिव',
  },
  {
    id: '01990000-0000-7000-8000-000000000102',
    key: 'general_manager',
    name: 'General Manager',
    nameHi: 'जनरल मैनेजर',
  },
  {
    id: '01990000-0000-7000-8000-000000000103',
    key: 'sales_team_lead',
    name: 'Sales Team Lead',
    nameHi: 'सेल्स टीम लीड',
  },
  {
    id: '01990000-0000-7000-8000-000000000104',
    key: 'tele_caller_cc',
    name: 'Tele-Caller (Cold Calling)',
    nameHi: 'टेली-कॉलर (कोल्ड कॉलिंग)',
  },
  {
    id: '01990000-0000-7000-8000-000000000105',
    key: 'tele_caller_lc',
    name: 'Tele-Caller (Lead Conversion)',
    nameHi: 'टेली-कॉलर (लीड कन्वर्ज़न)',
  },
  {
    id: '01990000-0000-7000-8000-000000000106',
    key: 'store_manager',
    name: 'Store Manager',
    nameHi: 'स्टोर मैनेजर',
  },
  {
    id: '01990000-0000-7000-8000-000000000107',
    key: 'inventory_manager',
    name: 'Inventory Manager',
    nameHi: 'इन्वेंटरी मैनेजर',
  },
  {
    id: '01990000-0000-7000-8000-000000000108',
    key: 'project_manager',
    name: 'Project Manager',
    nameHi: 'प्रोजेक्ट मैनेजर',
  },
  {
    id: '01990000-0000-7000-8000-000000000109',
    key: 'field_engineer',
    name: 'Field Engineer',
    nameHi: 'फ़ील्ड इंजीनियर',
  },
  {
    id: '01990000-0000-7000-8000-000000000110',
    key: 'accounts',
    name: 'Accounts',
    nameHi: 'अकाउंट्स',
  },
  {
    id: '01990000-0000-7000-8000-000000000111',
    key: 'hr_admin',
    name: 'HR Admin',
    nameHi: 'एचआर एडमिन',
  },
  {
    id: '01990000-0000-7000-8000-000000000201',
    key: 'agent:triage',
    name: 'Intake & Triage agent',
    nameHi: 'इनटेक और ट्राइएज एजेंट',
  },
  {
    id: '01990000-0000-7000-8000-000000000202',
    key: 'agent:concierge',
    name: 'WhatsApp Concierge agent',
    nameHi: 'व्हाट्सऐप कंसीयर्ज एजेंट',
  },
  {
    id: '01990000-0000-7000-8000-000000000203',
    key: 'agent:copilot',
    name: 'Caller Co-pilot agent',
    nameHi: 'कॉलर को-पायलट एजेंट',
  },
  {
    id: '01990000-0000-7000-8000-000000000204',
    key: 'agent:sizing',
    name: 'Sizing & Quote agent',
    nameHi: 'साइज़िंग और कोटेशन एजेंट',
  },
  {
    id: '01990000-0000-7000-8000-000000000205',
    key: 'agent:orchestrator',
    name: 'Project Orchestrator agent',
    nameHi: 'प्रोजेक्ट ऑर्केस्ट्रेटर एजेंट',
  },
  {
    id: '01990000-0000-7000-8000-000000000206',
    key: 'agent:chief',
    name: 'Chief of Staff agent',
    nameHi: 'चीफ़ ऑफ़ स्टाफ़ एजेंट',
  },
];

export function roleId(key: RoleKey): string {
  const row = ROLE_SEED.find((r) => r.key === key);
  if (!row) throw new Error(`no seeded role for ${key}`);
  return row.id;
}
