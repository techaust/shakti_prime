import {
  BankDetailsSchema,
  DomainError,
  hasGrant,
  type BankDetails,
  type EntityBankDetailsDto,
  type Principal,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import {
  FieldCipherError,
  FieldEnvelopeSchema,
  type CipherContext,
  type FieldCipher,
  type FieldEnvelope,
} from '../../privacy/field-cipher';

/**
 * A company's bank account (docs/SECURITY.md §5, BLUEPRINT §7): sealed by the field cipher into
 * `entities.bank_json` under the company's own context, so a sealed value copied to another
 * company, column or table does not open. No request role selects the column; the sealed value
 * comes back only through `app.entity_bank_envelope()`, which admits an Executive
 * (`admin.entities.write` at all scope) and the render worker (`files.process`).
 */
export function bankCipherContext(entityId: number): CipherContext {
  return { table: 'entities', column: 'bank_json', entityId, rowId: String(entityId) };
}

/** Seals the account for `entities.bank_json`. */
export function sealBankDetails(
  cipher: FieldCipher,
  entityId: number,
  details: BankDetails,
): Promise<FieldEnvelope> {
  return cipher.encrypt(JSON.stringify(details), bankCipherContext(entityId));
}

/** Opens a sealed account; throws `FieldCipherError` when it is not this company's. */
export async function openBankDetails(
  cipher: FieldCipher,
  entityId: number,
  sealed: unknown,
): Promise<BankDetails> {
  const envelope = FieldEnvelopeSchema.safeParse(sealed);
  if (!envelope.success) throw new FieldCipherError('not a sealed value');
  const text = await cipher.decrypt(envelope.data, bankCipherContext(entityId));
  const details = BankDetailsSchema.safeParse(JSON.parse(text));
  if (!details.success) throw new FieldCipherError('the sealed value is not a bank account');
  return details.data;
}

/** The last four digits of an account number, as the audit and the screens show it. */
export function accountEnding(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`;
}

/** Who may read a company's bank account in clear: an Executive, or the render worker. */
export function mayReadBankDetails(principal: Principal): boolean {
  return (
    hasGrant(principal.permissions, 'admin.entities.write', 'all') ||
    hasGrant(principal.permissions, 'files.process', 'entity')
  );
}

/**
 * The sealed account of a company in the request, or null when none is recorded. The database's
 * refusal of anyone else, or of a company outside the request, answers `forbidden`.
 */
export async function readSealedBankDetails(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
): Promise<unknown> {
  try {
    const rows = (await ctx.tx.execute(
      sql`select app.entity_bank_envelope(${entityId}::smallint) as bank`,
    )) as unknown as { bank: unknown }[];
    return rows[0]?.bank ?? null;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '42501') {
      throw new DomainError(
        'forbidden',
        'the bank account is refused to this caller',
        {},
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

/**
 * A company's bank account in clear, for the Executive changing it and for the print loader. A
 * caller who is neither is refused before the database is asked (which refuses as well); a
 * company outside the request is `not_found`, like any row the caller cannot see.
 */
export async function readEntityBankDetails(
  ctx: Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>,
  cipher: FieldCipher,
  entityId: number,
): Promise<EntityBankDetailsDto> {
  if (!mayReadBankDetails(ctx.principal)) {
    throw new DomainError('forbidden', 'the bank account needs admin.entities.write');
  }
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('not_found', 'entity not visible in this scope', { entityId });
  }
  const sealed = await readSealedBankDetails(ctx, entityId);
  if (sealed === null) return { entityId, bankDetails: null };
  try {
    return { entityId, bankDetails: await openBankDetails(cipher, entityId, sealed) };
  } catch (error) {
    // The key service is away, or the value is not this company's: nothing is shown.
    throw new DomainError(
      'integration_unavailable',
      'the bank account could not be opened',
      {},
      { cause: error },
    );
  }
}
