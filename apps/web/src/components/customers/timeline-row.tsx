'use client';

import type { ActivityDto } from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { SIZING_KINDS, TASK_KINDS } from '../../screens/contract-values';
import { isOneOf as oneOf } from '../../screens/customers';
import { formatDateTime } from '../../screens/format';

/** A timeline row in words: what happened, a detail when it has one, who and when. */
export function TimelineRow({ item }: { item: ActivityDto }) {
  const t = useTranslations('customers');
  const sizingT = useTranslations('sizing');
  const tagName = item.payload.tagName;
  const kind = item.payload.kind;
  const detail =
    item.type === 'note'
      ? item.body
      : typeof tagName === 'string'
        ? t('timeline.tagDetail', { name: tagName })
        : item.type === 'sizing_recorded' && typeof kind === 'string' && oneOf(SIZING_KINDS, kind)
          ? t(
              item.payload.inBounds === true
                ? 'timeline.sizingInBounds'
                : 'timeline.sizingOutOfBounds',
              {
                kind: sizingT(`kind.${kind}`),
              },
            )
          : typeof kind === 'string' && oneOf(TASK_KINDS, kind)
            ? t(`tasks.kind.${kind}`)
            : item.type === 'call_logged' && typeof item.payload.outcomeName === 'string'
              ? t('timeline.callDetail', { outcome: item.payload.outcomeName })
              : null;
  return (
    <li className="border-border flex min-w-0 flex-col gap-0.5 border-l-2 pl-3">
      <span className="font-medium">{t(`timeline.type.${item.type}`)}</span>
      {detail === null ? null : <span className="break-words whitespace-pre-line">{detail}</span>}
      <span className="text-text-muted text-xs">
        {t('timeline.by', {
          name: item.actorName ?? t('timeline.someone'),
          when: formatDateTime(item.createdAt),
        })}
      </span>
    </li>
  );
}
