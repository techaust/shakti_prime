import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { readTaxSettings } from '../../../../actions/tax';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { TaxSettingsScreen } from '../../../../components/tax/tax-settings-screen';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('settings-tax'), (await getTranslations('taxSettings'))('title'));
}

/**
 * Settings › Tax rates (SAL-02, ADR 0007): GST rates by HSN code or item and the composite
 * supply splits, for Accounts. They carry no company, so they change only while the person acts
 * for every company; the screen says so rather than letting the change be refused.
 */
export default async function TaxSettingsPage() {
  await screenAccess(navRequires('settings-tax'));
  const t = await getTranslations('taxSettings');
  const settings = await readTaxSettings();
  return (
    <Page title={t('title')} description={t('intro')}>
      {settings.ok ? (
        <TaxSettingsScreen initial={settings.data} />
      ) : (
        <FailureMessage failure={firstFailure(settings)} />
      )}
    </Page>
  );
}
