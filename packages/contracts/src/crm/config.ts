import { z } from 'zod';

/**
 * CRM set-up enumerations (docs/design/phase1.md §6.6, docs/DATABASE.md §6.2). Values are the
 * database check lists; `enum-sync.test.ts` pairs each with its constraint.
 */

/** What the queue does after a call outcome (CALL-1, TEL-01). */
export const DispositionNextActionSchema = z.enum([
  'callback',
  'retry',
  'qualified',
  'not_interested',
  'wrong_number',
  'nurture',
]);
export type DispositionNextAction = z.infer<typeof DispositionNextActionSchema>;

/** What a lead score rule looks at (CRM-06, workshop CRM-3). */
export const ScoreFactorSchema = z.enum([
  'source',
  'segment',
  'district',
  'system_size',
  'age_days',
]);
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

/** How a referral partner's commission is worked out (workshop CRM-5). */
export const CommissionBasisSchema = z.enum(['fixed', 'percent', 'per_kw', 'per_hp']);
export type CommissionBasis = z.infer<typeof CommissionBasisSchema>;

/** When a commission is earned; payment-linked release arrives with the Tally receipts. */
export const CommissionTriggerSchema = z.enum(['order_confirmed']);
export type CommissionTrigger = z.infer<typeof CommissionTriggerSchema>;

/** Where a commission on an order stands; release on payment arrives with the Tally receipts. */
export const CommissionAccrualStateSchema = z.enum(['accrued', 'cancelled']);
export type CommissionAccrualState = z.infer<typeof CommissionAccrualStateSchema>;

/** The unit a system-size score rule reads the lead's size in. */
export const SystemSizeUnitSchema = z.enum(['kw', 'hp']);
export type SystemSizeUnit = z.infer<typeof SystemSizeUnitSchema>;

/** A referral code: 4 to 12 letters and digits, matched whatever its case. */
export const ReferralCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{4,12}$/);

/** The code of a call outcome, as reports count it. */
export const DispositionCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/);

/**
 * The group's call outcomes until the sales head answers CALL-1: the workshop pack's example list,
 * each with the queue's next step. A workshop default (`WORKSHOP_DEFAULTS.crm.dispositions`,
 * docs/design/phase1.md §11); the seed writes it once, and Executives change it on the pipelines
 * settings page.
 */
export const WORKSHOP_DISPOSITIONS: readonly {
  key: number;
  code: string;
  label: string;
  nextAction: DispositionNextAction;
}[] = [
  { key: 1, code: 'interested', label: 'Interested', nextAction: 'callback' },
  { key: 2, code: 'call_back_later', label: 'Call back later', nextAction: 'callback' },
  { key: 3, code: 'not_reachable', label: 'Not reachable', nextAction: 'retry' },
  { key: 4, code: 'switched_off', label: 'Switched off', nextAction: 'retry' },
  { key: 5, code: 'wrong_number', label: 'Wrong number', nextAction: 'wrong_number' },
  { key: 6, code: 'not_interested', label: 'Not interested', nextAction: 'not_interested' },
  { key: 7, code: 'already_bought', label: 'Already bought', nextAction: 'not_interested' },
  { key: 8, code: 'qualified', label: 'Qualified', nextAction: 'qualified' },
];
