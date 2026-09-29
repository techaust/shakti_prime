// Customer screens: pure helpers the pages, the leads grid and the board share.

import type { Route } from 'next';

/** Account 360 of a customer as one company deals with them. */
export function customerHref(accountId: string, entityId: number): Route {
  return `/customers/${accountId}?company=${String(entityId)}` as Route;
}

/** The company an Account 360 address asks for, when it names a whole number. */
export function companyParam(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^[1-9][0-9]{0,4}$/.test(raw)) return undefined;
  return Number(raw);
}

/** A due time typed into a `datetime-local` field, read as India time, as an ISO instant. */
export function dueFromLocal(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const at = Date.parse(`${value}:00+05:30`);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

/** An instant as a `datetime-local` value in India time, for a field's starting value. */
export function localFromIso(iso: string): string {
  const shifted = new Date(Date.parse(iso) + (5 * 60 + 30) * 60_000);
  return shifted.toISOString().slice(0, 16);
}
