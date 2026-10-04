import { DomainError, EntityDto, UpdateEntityInput, type BankDetails } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import type { FieldEnvelope } from '../../privacy/field-cipher';
import {
  accountEnding,
  openBankDetails,
  readSealedBankDetails,
  sealBankDetails,
} from '../../queries/org/bank-details';
import { ENTITY_COLUMNS, toEntityDto } from '../../queries/org/entity-dto';

/** The fields the command may change, in the order the audit row and the event list them. */
const EDITABLE = [
  'brandName',
  'upiId',
  'gstin',
  'stateCode',
  'addressLine1',
  'addressLine2',
  'city',
  'pin',
] as const;

type Changed = (typeof EDITABLE)[number] | 'bankDetails';

/**
 * How the audit shows a bank account: the last four digits of its number, never the rest, the
 * bank, the IFSC or the branch; `null` when none is recorded.
 */
function audited(details: BankDetails | null): string | null {
  return details === null ? null : accountEnding(details.accountNumber);
}

/**
 * The account recorded before this change, for the audit row only. A sealed value that no longer
 * opens (another key, a damaged value) is shown as its four stars, so a broken account can still
 * be replaced.
 */
async function auditedBefore(ctx: CommandContext, entityId: number): Promise<string | null> {
  const sealed = await readSealedBankDetails(ctx, entityId);
  if (sealed === null || ctx.fieldCipher === undefined) return sealed === null ? null : '****';
  try {
    return audited(await openBankDetails(ctx.fieldCipher, entityId, sealed));
  } catch {
    return '****';
  }
}

/**
 * `org.entity.update`: an Executive changes the brand name, UPI id, GSTIN, registered address or
 * bank account of an entity in scope (workshop pack SALE-2, docs/design/phase1.md §6.4). The GSTIN
 * must start with the company's GST state code, checked against the stored value of whichever of
 * the two this call leaves alone. The bank account is sealed by the runtime's field cipher before
 * it is stored (`integration_unavailable` without one) and is audited as the last four digits of
 * its number. RLS hides entities outside the request scope, so the command answers `not_found`
 * there rather than confirming the entity exists.
 */
export const updateEntity = defineCommand({
  name: 'org.entity.update',
  permission: 'admin.entities.write',
  minScope: 'all',
  input: UpdateEntityInput,
  output: EntityDto,
  auditFields: [...EDITABLE, 'bankAccount'],
  // The account itself never reaches the audit row: only its last four digits.
  auditInput: ({ bankDetails, ...rest }) =>
    bankDetails === undefined ? rest : { ...rest, bankAccount: audited(bankDetails) },
  async handler(ctx, input) {
    const patch: Partial<Pick<typeof schema.entities.$inferInsert, (typeof EDITABLE)[number]>> = {};
    for (const field of EDITABLE) {
      const value = input[field];
      if (value !== undefined) Object.assign(patch, { [field]: value });
    }
    const fields: Changed[] = EDITABLE.filter((f) => f in patch);
    const bankChanged = input.bankDetails !== undefined;
    if (bankChanged) fields.push('bankDetails');
    if (fields.length === 0) {
      throw new DomainError('validation_failed', 'nothing to update', { entityId: input.entityId });
    }

    // Sealed before any row is locked: the key service is a network call.
    let sealed: FieldEnvelope | null | undefined;
    if (input.bankDetails !== undefined && input.bankDetails !== null) {
      if (ctx.fieldCipher === undefined) {
        throw new DomainError('integration_unavailable', 'no field cipher on this runtime');
      }
      sealed = await sealBankDetails(ctx.fieldCipher, input.entityId, input.bankDetails);
    } else if (input.bankDetails === null) {
      sealed = null;
    }
    // The account it replaces is opened for the audit row before the lock too, for the same
    // reason; it feeds only the audit row, and an Executive's edit of the same company racing this
    // one is rare enough that a before value read a moment early is acceptable. A company outside
    // the request is left to the select below, which answers `not_found`.
    const bankBefore =
      bankChanged && ctx.entityIds.includes(input.entityId)
        ? await auditedBefore(ctx, input.entityId)
        : undefined;

    const e = schema.entities;
    const [before] = await ctx.tx
      .select(ENTITY_COLUMNS)
      .from(e)
      .where(eq(e.id, input.entityId))
      .limit(1)
      .for('update');
    if (!before) {
      throw new DomainError('not_found', 'entity not visible in this scope', {
        entityId: input.entityId,
      });
    }
    const gstin = patch.gstin === undefined ? before.gstin : patch.gstin;
    const stateCode = patch.stateCode ?? before.stateCode;
    if (gstin !== null && !gstin.startsWith(stateCode)) {
      throw new DomainError('validation_failed', 'the GSTIN is of another state', {
        reason: 'gstin_state_mismatch',
        issues: [{ path: patch.gstin === undefined ? 'stateCode' : 'gstin', message: 'state' }],
      });
    }
    const [row] = await ctx.tx
      .update(e)
      .set({
        ...patch,
        ...(sealed === undefined ? {} : { bankJson: sealed }),
        updatedBy: ctx.principal.id,
      })
      .where(eq(e.id, input.entityId))
      .returning(ENTITY_COLUMNS);
    if (!row) {
      throw new DomainError('not_found', 'entity not visible in this scope', {
        entityId: input.entityId,
      });
    }

    const plain = EDITABLE.filter((f) => f in patch);
    const bank = (value: string | null | undefined) =>
      bankChanged ? { bankAccount: value ?? null } : {};
    ctx.audit({
      aggregateType: 'entity',
      aggregateId: String(row.id),
      entityId: row.id,
      before: { ...pick(before, plain), ...bank(bankBefore) },
      after: {
        ...pick(row, plain),
        ...bank(bankChanged ? audited(input.bankDetails ?? null) : null),
      },
    });
    ctx.emit({
      type: 'org.entity.updated',
      entityId: row.id,
      aggregateType: 'entity',
      aggregateId: String(row.id),
      payload: { fields },
    });
    return toEntityDto(row);
  },
});

/** The changed fields only, so the audit row shows what this call touched. */
function pick(source: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]));
}
