'use client';

import type { NoticePreferenceDto, NotificationSettingsDto } from '@shakti/contracts';
import { Button, Field, Input, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { saveNotificationSettings } from '../../actions/notifications';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { useCommand } from '../screens/use-command';

const FIELDS = ['quietFrom', 'quietTo'] as const;

/**
 * Settings › Notifications (docs/03-roadmap-appendix/phase1.md §8.1): for each kind of notice, whether it shows
 * in Notifications and whether it also comes as an alert, and the quiet hours in which no alert is
 * sent. Saved together, through `notifications.preferences.set`.
 */
export function NotificationSettingsForm({ saved }: { saved: NotificationSettingsDto }) {
  const t = useTranslations('notifications.settings');
  const kinds = useTranslations('notifications.types');
  const [types, setTypes] = useState<NoticePreferenceDto[]>(saved.types);
  const [quietFrom, setQuietFrom] = useState(saved.quietFrom ?? '');
  const [quietTo, setQuietTo] = useState(saved.quietTo ?? '');
  const { run, pending, failure } = useCommand(saveNotificationSettings);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);

  function toggle(type: NoticePreferenceDto['type'], field: 'inApp' | 'push', value: boolean) {
    setTypes((all) => all.map((row) => (row.type === type ? { ...row, [field]: value } : row)));
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    run(
      {
        types,
        quietFrom: quietFrom === '' ? null : quietFrom,
        quietTo: quietTo === '' ? null : quietTo,
      },
      (next) => {
        setTypes(next.types);
        setQuietFrom(next.quietFrom ?? '');
        setQuietTo(next.quietTo ?? '');
        toast.success(t('saved'));
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <section className="flex flex-col gap-3">
        <h2 className="text-h3">{t('kindsHeading')}</h2>
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('kindsCaption')}</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t('kind')}
                </th>
                <th scope="col" className="px-3 py-2 text-center font-medium">
                  {t('inApp')}
                </th>
                <th scope="col" className="px-3 py-2 text-center font-medium">
                  {t('pushColumn')}
                </th>
              </tr>
            </thead>
            <tbody>
              {types.map((row) => {
                const kind = kinds(row.type);
                return (
                  <tr key={row.type} className="border-border border-t">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {kind}
                    </th>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-accent size-4"
                        aria-label={t('inAppLabel', { kind })}
                        checked={row.inApp}
                        onChange={(e) => {
                          toggle(row.type, 'inApp', e.currentTarget.checked);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-accent size-4"
                        aria-label={t('pushLabel', { kind })}
                        checked={row.push}
                        onChange={(e) => {
                          toggle(row.type, 'push', e.currentTarget.checked);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-h3">{t('quietHeading')}</h2>
        <p className="text-text-muted text-sm">{t('quietIntro')}</p>
        <div className="flex flex-wrap gap-4">
          <Field
            id="quiet-from"
            label={t('quietFrom')}
            helper={t('quietHelper')}
            error={fieldError('quietFrom')}
          >
            <Input
              type="time"
              value={quietFrom}
              onChange={(e) => {
                setQuietFrom(e.currentTarget.value);
              }}
            />
          </Field>
          <Field
            id="quiet-to"
            label={t('quietTo')}
            helper={t('quietHelper')}
            error={fieldError('quietTo')}
          >
            <Input
              type="time"
              value={quietTo}
              onChange={(e) => {
                setQuietTo(e.currentTarget.value);
              }}
            />
          </Field>
        </div>
      </section>
      <FailureMessage failure={formFailure} />
      <Button type="submit" className="self-start" pending={pending}>
        {t('save')}
      </Button>
    </form>
  );
}
