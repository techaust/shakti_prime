import {
  hasGrant,
  IMPLEMENTED_IMPORT_KINDS,
  IMPORT_LIMITS,
  type ImplementedImportKind,
} from '@shakti/contracts';
import { executeQuery, requestCoversAllCompanies } from '@shakti/domain';
import { EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UploadForm } from '../../../../components/imports/upload-form';
import { ImportSteps } from '../../../../components/imports/import-steps';
import { Page } from '../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('imports'), (await getTranslations('imports.upload'))('title'));
}

/**
 * New import, step one: the company, what the file holds and the file itself. In All companies
 * mode the person chooses the company; only companies where their role may import are offered.
 * The PIN code list is shared by every company, so it is offered only to an Executive working in
 * all of them (docs/03-roadmap-appendix/phase1.md §6.3); the catalogue's items likewise only to a
 * holder of `catalogue.write` working in all of them (phase3 §6.1). `?kind=items` (the items grid's
 * Import items) chooses that kind first.
 */
export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access } = await screenAccess(navRequires('imports'));
  const t = await getTranslations('imports.upload');
  const companies = access.entities
    .filter(
      (e) =>
        principal.entityIds.includes(e.entityId) && hasGrant(e.grants, 'imports.write', 'entity'),
    )
    .map((e) => ({ id: e.entityId, name: e.entityName }));
  const coversAll = await executeQuery(principal, {}, (ctx) => requestCoversAllCompanies(ctx), {
    name: 'imports.new.coversAll',
  });
  const group = hasGrant(principal.permissions, 'imports.write', 'all') && coversAll;
  const catalogue = hasGrant(principal.permissions, 'catalogue.write', 'entity') && coversAll;
  // Opening stock carries costs and posts through the stock ledger (H1): finance.cost.read and
  // inventory.stock.adjust, both, as imports.job.create checks.
  const stock =
    hasGrant(principal.permissions, 'inventory.stock.adjust', 'entity') &&
    hasGrant(principal.permissions, 'finance.cost.read', 'entity');
  // U1: a vendor list is written through the procurement commands (procurement.po.write).
  const vendors = hasGrant(principal.permissions, 'procurement.po.write', 'entity');
  // R3: the installed base enters serials with their warranty (inventory.warranty.write).
  const warranty = hasGrant(principal.permissions, 'inventory.warranty.write', 'entity');
  const kinds = IMPLEMENTED_IMPORT_KINDS.filter(
    (kind) =>
      (kind !== 'pin_codes' || group) &&
      (kind !== 'items' || catalogue) &&
      (kind !== 'opening_stock' || stock) &&
      (kind !== 'vendors' || vendors) &&
      (kind !== 'installed_base' || warranty),
  );
  const asked = (await searchParams).kind;
  const initialKind = kinds.find((k): k is ImplementedImportKind => k === asked);
  return (
    <Page title={t('title')} description={t('intro')} width="form">
      <ImportSteps state={undefined} />
      {companies.length === 0 ? (
        <EmptyState message={t('noCompany')} />
      ) : (
        <UploadForm
          companies={companies}
          kinds={kinds}
          {...(initialKind === undefined ? {} : { initialKind })}
          limits={{ maxFileBytes: IMPORT_LIMITS.maxFileBytes, maxRows: IMPORT_LIMITS.maxRows }}
        />
      )}
    </Page>
  );
}
