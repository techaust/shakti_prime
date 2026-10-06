import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notificationSettings } from '../../../../actions/notifications';
import { NotificationSettingsForm } from '../../../../components/notifications/notification-settings';
import { PushToggle } from '../../../../components/notifications/push-toggle';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { vapidConfig } from '../../../../notifications/push';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(undefined, (await getTranslations('notifications.settings'))('title'));
}

/**
 * Settings › Notifications (docs/design/phase1.md §8.1), reached from the profile menu and the
 * notification centre: the person's own choices per kind of notice, their quiet hours, and alerts
 * on this browser. Everyone who is signed in has notifications, so the page needs no permission.
 */
export default async function NotificationSettingsPage() {
  await screenAccess();
  const t = await getTranslations('notifications.settings');
  const settings = await notificationSettings();
  return (
    <Page width="form" title={t('title')} description={t('intro')}>
      <section className="bg-surface border-border flex flex-col gap-3 rounded-lg border p-6">
        <h2 className="text-h3">{t('browserHeading')}</h2>
        <p className="text-text-muted text-sm">{t('browserIntro')}</p>
        <PushToggle publicKey={vapidConfig()?.publicKey ?? null} />
      </section>
      <section className="bg-surface border-border rounded-lg border p-6">
        {settings.ok ? (
          <NotificationSettingsForm saved={settings.data} />
        ) : (
          <FailureMessage failure={firstFailure(settings)} />
        )}
      </section>
    </Page>
  );
}
