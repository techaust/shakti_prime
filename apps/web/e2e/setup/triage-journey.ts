// The Triage agent's journey fixtures (`e2e/triage.spec.ts`), shared by the seed and the spec:
// one lead in the snapshot company that the seed's stand-in run triages in Shadow, once, under a
// fixed event id, so every run of the seed finds the same proposals.

export const TRIAGE_JOURNEY = {
  /** The lead's customer, made by the seed in the snapshot company. */
  customer: 'Gopal Lal Kumawat',
  phone: '98765 40031',
  /** The `crm.lead.created` event the stand-in run stands for. */
  eventId: '0199e2e0-0000-7000-8000-00000000a201',
  /** The daily spending limit the run is given while it runs, then taken away. */
  capId: '0199e2e0-0000-7000-8000-00000000a202',
  /** The note the stand-in model gives with its score change. */
  scoreNote: 'Walk-in pump enquiry during working hours.',
} as const;
