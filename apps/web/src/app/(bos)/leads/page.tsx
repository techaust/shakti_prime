import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { leadFormOptions, listLeads } from '../../../actions/crm';
import { LeadsScreen } from '../../../components/leads/leads-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Screen } from '../../../components/screens/screen';
import { companyNames, screenAccess } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('leads'))('title') };
}

/** Leads: the leads the caller can see, newest change first, a page at a time. */
export default async function LeadsPage() {
  const { principal, access, can } = await screenAccess({ key: 'crm.lead.read', scope: 'own' });
  const t = await getTranslations('leads');
  const canAdd = can('crm.lead.write', 'own') && can('crm.account.write', 'own');
  const [page, options] = await Promise.all([listLeads({ limit: 50 }), leadFormOptions()]);
  return (
    <Screen
      title={t('title')}
      intro={t('intro')}
      actions={
        canAdd ? (
          <Button asChild>
            <Link href="/leads/new">{t('add')}</Link>
          </Button>
        ) : undefined
      }
    >
      {page.ok && options.ok ? (
        <LeadsScreen
          initial={page.data}
          pipelines={options.data.pipelines}
          companies={companyNames(access)}
          showCompany={principal.entityIds.length > 1}
          canAdd={canAdd}
        />
      ) : (
        <FailureMessage failure={firstFailure(page, options)} />
      )}
    </Screen>
  );
}
