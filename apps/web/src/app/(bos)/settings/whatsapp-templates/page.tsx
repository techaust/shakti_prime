import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { loadWhatsAppTemplateSettings } from '../../../../actions/whatsapp-templates';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { TemplatesScreen } from '../../../../components/whatsapp-templates/templates-screen';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-whatsapp-templates'),
    (await getTranslations('whatsappTemplates'))('title'),
  );
}

/**
 * Settings › WhatsApp templates (`messaging.templates.write`, docs/03-roadmap-appendix/phase2.md
 * §7.1): each company's registered WhatsApp templates and the customer updates its number sends,
 * each mapped to one of its templates.
 */
export default async function WhatsAppTemplatesPage() {
  const { access, principal, can } = await screenAccess(navRequires('settings-whatsapp-templates'));
  const t = await getTranslations('whatsappTemplates');
  const settings = await loadWhatsAppTemplateSettings();
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {settings.ok ? (
        <TemplatesScreen
          companies={companies}
          initial={settings.data}
          canChange={can('messaging.templates.write', 'all')}
        />
      ) : (
        <FailureMessage failure={firstFailure(settings)} />
      )}
    </Page>
  );
}
