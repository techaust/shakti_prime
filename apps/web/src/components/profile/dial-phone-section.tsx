import { hasGrant } from '@shakti/contracts';
import { ownDialPhone } from '../../actions/dialling';
import { companyNames, screenAccess } from '../../screens/access';
import { DialPhoneForm } from './dial-phone-form';

/**
 * The profile's section for the person's own calling phone, for whoever dials (`calls.dial`):
 * one number per company they work in, read here and saved by `DialPhoneForm`. Nothing for anyone
 * else.
 */
export async function DialPhoneSection() {
  const { principal, access } = await screenAccess();
  if (!hasGrant(principal.permissions, 'calls.dial', 'own')) return null;
  const names = companyNames(access);
  const rows = (
    await Promise.all(
      principal.entityIds.map(async (entityId) => ({
        entityId,
        company: names[entityId] ?? String(entityId),
        result: await ownDialPhone({ entityId }),
      })),
    )
  ).flatMap((r) =>
    r.result.ok ? [{ entityId: r.entityId, company: r.company, phone: r.result.data }] : [],
  );
  if (rows.length === 0) return null;
  return (
    <section
      id="dial-phone"
      className="bg-surface border-border scroll-mt-20 rounded-lg border p-6"
    >
      <DialPhoneForm rows={rows} />
    </section>
  );
}
