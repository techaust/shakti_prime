// What the shadow review pack journey (`e2e/shadow-pack.spec.ts`) and its seed
// (`e2e/setup/shadow-pack.ts`) agree on. No database code here, so the journey runs inside the
// Linux snapshot container too.
//
// The journey's own rows, which no other journey touches: a customer of company 2 with its lead
// and WhatsApp chat, and the two agents' proposals, runs and hand-offs on it in one week of June
// 2025, with what a person did after them, all written once with fixed ids. The reports are opened
// at that week through their period inputs, so every figure is the seed's alone, whichever
// journeys ran before.

export const SHADOW_PACK = {
  company: { entityId: 2, name: 'Shakti Motor Pumps' },
  /** The week, as the period inputs take it (DD-MM-YYYY) and as the reports show it. */
  from: '02-06-2025',
  to: '08-06-2025',
  /** A synthetic customer for the journey alone, and the number it writes from. */
  customer: 'Devki Nandan Sharma',
  phone: '+919812300401',
  asked: 'Is the 5 HP pump available this week?',
  askedAgain: 'Please also tell me the price.',
  /** The assistant's two drafts in Shadow, and what a person sent after the first. */
  drafts: [
    'Thank you for asking. A team member will call you today about the 5 HP pump.',
    'Our engineer will confirm the visit day when the team calls.',
  ],
  sent: 'Yes, it is in stock. We will call you at 4 PM today.',
} as const;
