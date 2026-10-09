import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { targetsScreen } from '../../../actions/targets';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { TargetsScreen } from '../../../components/targets/targets-screen';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { companyParam } from '../../../screens/customers';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('targets'), (await getTranslations('targets'))('title'));
}

/**
 * Targets (docs/03-roadmap-appendix/phase1.md §9, PRD TEL-06): where a team lead, the General
 * Manager or an Executive sets the calls, qualified leads, orders and kW a caller or a team is
 * held to, and reads what is set and what was set before. The company is the one being viewed, or
 * the one chosen with `?company=` among the request's companies.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, activeEntityId } = await screenAccess(navRequires('targets'));
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const t = await getTranslations('targets');
  const names = companyNames(access);
  const screen = await targetsScreen({ entityId });
  return (
    <Page
      width="detail"
      title={t('title')}
      actions={
        principal.entityIds.length > 1 ? (
          <nav aria-label={t('companyLabel')} className="flex flex-wrap items-center gap-1">
            {principal.entityIds.map((id) => (
              <Button key={id} asChild variant={id === entityId ? 'secondary' : 'ghost'}>
                <Link
                  href={`/targets?company=${String(id)}`}
                  aria-current={id === entityId ? 'page' : undefined}
                >
                  {names[id] ?? String(id)}
                </Link>
              </Button>
            ))}
          </nav>
        ) : undefined
      }
      description={
        principal.entityIds.length > 1
          ? t('introCompany', { company: names[entityId] ?? '' })
          : t('intro')
      }
    >
      {screen.ok ? (
        <TargetsScreen key={entityId} data={screen.data} />
      ) : (
        <FailureMessage failure={firstFailure(screen)} />
      )}
    </Page>
  );
}
