import { z } from 'zod';

/** Catalogue and pricing enumerations (docs/DATABASE.md §6.3). Values are the DB check lists. */
export const ItemUnitSchema = z.enum(['nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour']);
export type ItemUnit = z.infer<typeof ItemUnitSchema>;

/** The three tiers of docs/BLUEPRINT.md §8.3; the list is extensible from Admin, not from code. */
export const PriceTierCodeSchema = z.enum(['retail', 'dealer', 'commercial']);
export type PriceTierCode = z.infer<typeof PriceTierCodeSchema>;

/** Money as the API carries it: rupees with two decimals, never a float (docs/API.md §1). */
export const MoneySchema = z.string().regex(/^\d{1,12}\.\d{2}$/);
export type Money = z.infer<typeof MoneySchema>;

/** Money that may be negative: a document's rupee round-off, or a Tally debit or credit side. */
export const SignedMoneySchema = z.string().regex(/^-?\d{1,12}\.\d{2}$/);
export type SignedMoney = z.infer<typeof SignedMoneySchema>;

/** Rates such as costs keep four decimals (docs/DATABASE.md §2). */
export const RateSchema = z.string().regex(/^\d{1,10}\.\d{4}$/);
export type Rate = z.infer<typeof RateSchema>;

/** HSN codes are four to eight digits. */
export const HsnSchema = z.string().regex(/^[0-9]{4,8}$/);
