'use client';

import type { LeaveRequestState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { LEAVE_REQUEST_STATES } from '../../screens/contract-values';

/** A company a setting or a person belongs to, or the whole group (`id` null). */
export interface CompanyOption {
  id: number | null;
  name: string;
}

/** The badge tone of each state of a leave request. */
export const LEAVE_STATE_TONE: Readonly<Record<LeaveRequestState, StatusTone>> = {
  requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** A leave request's state in words. */
export function useLeaveStateText(): (state: string) => string {
  const t = useTranslations('hr.leaveState');
  return (state) =>
    (LEAVE_REQUEST_STATES as readonly string[]).includes(state)
      ? t(state as LeaveRequestState)
      : state;
}

type WeekdayCode = '1' | '2' | '3' | '4' | '5' | '6' | '7';

/** A day of the week (ISO 1 to 7) in words. */
export function useDayName(): (day: number) => string {
  const t = useTranslations('hr');
  return (day) => t(`weekday.${String(day) as WeekdayCode}`);
}

/** A shift's days off in words, joined; "None" when it has none. */
export function useWeekdayText(): (days: readonly number[]) => string {
  const t = useTranslations('hr');
  const dayName = useDayName();
  return (days) =>
    days.length === 0 ? t('noDaysOff') : days.map(dayName).join(t('listSeparator'));
}

/** A company's name by id; the whole group for null. */
export function companyName(companies: readonly CompanyOption[], id: number | null): string {
  return companies.find((c) => c.id === id)?.name ?? '';
}
