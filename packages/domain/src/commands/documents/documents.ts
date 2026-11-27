import {
  DocumentDto,
  DocumentRequirementDto,
  DocumentViewDto,
  DomainError,
  FileDocumentInput,
  hasGrant,
  isSensitiveKind,
  newId,
  SetDocumentRequirementInput,
  UnfileDocumentInput,
  ViewDocumentInput,
  type DocumentKind,
  type IdentityDocumentKind,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { readDocument, toDocumentDto, toRequirementDto } from '../../queries/documents/documents';
import { lockFile, scanResultOf, type FileRow } from '../files/shared';
import { assertEntityInScope } from '../imports/shared';

/*
 * J3 Customer documents (docs/03-roadmap-appendix/phase4.md §6.3, SECURITY §5, §11 items 7 and
 * 8). Only people file, unfile and open documents: the classifier's filing (J7) is the platform's
 * own command. The audit rows carry ids, kinds and counts, never a digit of an identity number.
 */

/** The number each sensitive kind keeps the last four digits of, read from the masking step. */
const IDENTITY_NUMBER_OF: Partial<
  Record<DocumentKind, { kind: IdentityDocumentKind; from: 'aadhaar' | 'bankAccount' }>
> = {
  identity_proof: { kind: 'aadhaar', from: 'aadhaar' },
  bank_proof: { kind: 'bank_proof', from: 'bankAccount' },
};

/** Whether a checked file passed the malware scan, or may go without one on this runtime. */
function scannedClean(ctx: CommandContext, file: FileRow): boolean {
  const { verdict } = scanResultOf(file);
  return verdict === 'no_threats_found' || (verdict === 'not_scanned' && !ctx.hosted);
}

/**
 * The file a document is filed from: a customer document of the company, uploaded for this
 * customer, through its checks, clean and masked. The caller reaches it only as its uploader while
 * it is not filed, or with a document of it they may read (`files_customer_document_read`).
 */
async function fileToFile(ctx: CommandContext, input: FileDocumentInput): Promise<FileRow> {
  const file = await lockFile(ctx, input.fileId, 'customer_document');
  if (file.entityId !== input.entityId || file.deletedAt !== null) {
    throw new DomainError('not_found', `file ${input.fileId} is not in the company`, {
      reason: 'file_missing',
    });
  }
  // The file names the customer it was uploaded for; it is filed against that customer alone.
  if (file.accountId !== input.accountId) {
    throw new DomainError('forbidden', 'the file was uploaded for another customer', {
      reason: 'file_customer_mismatch',
    });
  }
  if (file.status === 'rejected') {
    throw new DomainError('conflict', `file ${file.id} was refused by its checks`, {
      reason: 'file_not_clean',
    });
  }
  if (file.status !== 'ready') {
    throw new DomainError('conflict', `file ${file.id} is still being checked`, {
      reason: 'document_file_not_ready',
    });
  }
  if (!scannedClean(ctx, file)) {
    throw new DomainError('conflict', `file ${file.id} has no clean scan`, {
      reason: 'file_not_clean',
    });
  }
  if (scanResultOf(file).sanitising !== 'masked') {
    throw new DomainError('conflict', `file ${file.id} was not masked`, {
      reason: 'file_not_masked',
    });
  }
  return file;
}

/** A kind the requirement accepts in some step of the company, while the requirement is on. */
async function assertKindAccepted(ctx: CommandContext, input: FileDocumentInput): Promise<void> {
  if (input.requirementKey === null) return;
  const r = schema.documentRequirements;
  const [accepted] = await ctx.tx
    .select({ id: r.id })
    .from(r)
    .where(
      and(
        eq(r.entityId, input.entityId),
        eq(r.requirementKey, input.requirementKey),
        eq(r.active, true),
        sql`${input.kind} = any (${r.acceptedKinds})`,
      ),
    )
    .limit(1);
  if (!accepted) {
    throw new DomainError('validation_failed', 'the requirement does not take this kind', {
      reason: 'document_kind_not_accepted',
    });
  }
}

/**
 * `documents.file`: files a checked customer document against the customer it was uploaded for,
 * on a requirement or as a loose document of its kind. An identity or bank paper is sensitive:
 * only a holder of `documents.sensitive.read` files one, and its number's last four digits, which
 * the masking step kept, become its identity document (SECURITY §5).
 */
export const fileDocument = defineCommand({
  name: 'documents.file',
  permission: 'documents.write',
  minScope: 'own',
  peopleOnly: true,
  input: FileDocumentInput,
  output: DocumentDto,
  auditFields: ['documentKind', 'requirementKey', 'sensitive', 'identityNumbers'],
  constraintReasons: { documents_file_filed_unique: 'document_file_taken' },
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const sensitive = isSensitiveKind(input.kind);
    if (sensitive && !hasGrant(ctx.principal.permissions, 'documents.sensitive.read', 'entity')) {
      throw new DomainError('forbidden', 'a sensitive document needs documents.sensitive.read', {
        reason: 'document_sensitive_forbidden',
      });
    }
    const file = await fileToFile(ctx, input);
    await assertKindAccepted(ctx, input);

    const id = newId();
    const filedAt = ctx.now;
    // No `returning`: the insert's policy decides, and the row is built from what was written.
    await ctx.tx.insert(schema.documents).values({
      id,
      entityId: input.entityId,
      accountId: input.accountId,
      projectId: null,
      requirementKey: input.requirementKey,
      kind: input.kind,
      fileId: file.id,
      sensitive,
      filedByKind: 'person',
      filedBy: ctx.principal.id,
      confidence: null,
      filedAt,
    });

    const numbers: { kind: IdentityDocumentKind; lastFour: string }[] = [];
    const identity = IDENTITY_NUMBER_OF[input.kind];
    if (identity !== undefined) {
      const kept = scanResultOf(file).lastFour?.[identity.from] ?? [];
      for (const lastFour of new Set(kept)) {
        // The masking step keeps four digits at most; anything else is never stored.
        if (!/^[0-9]{4}$/.test(lastFour)) continue;
        await ctx.tx.insert(schema.identityDocuments).values({
          id: newId(),
          entityId: input.entityId,
          accountId: input.accountId,
          documentId: id,
          kind: identity.kind,
          last4: lastFour,
          maskedFileId: file.id,
          createdBy: ctx.principal.id,
        });
        numbers.push({ kind: identity.kind, lastFour });
      }
    }

    ctx.audit({
      aggregateType: 'document',
      aggregateId: id,
      entityId: input.entityId,
      after: {
        accountId: input.accountId,
        fileId: file.id,
        documentKind: input.kind,
        requirementKey: input.requirementKey,
        sensitive,
        identityNumbers: numbers.length,
      },
    });
    return toDocumentDto(
      {
        id,
        entityId: input.entityId,
        accountId: input.accountId,
        projectId: null,
        requirementKey: input.requirementKey,
        kind: input.kind,
        fileId: file.id,
        sensitive,
        filedByKind: 'person',
        filedBy: ctx.principal.id,
        confidence: null,
        filedAt,
        unfiledAt: null,
        unfiledBy: null,
        unfiledReason: null,
        updatedAt: filedAt,
      },
      numbers,
    );
  },
});

/**
 * `documents.unfile`: a document leaves its requirement, with the reason (a misfiled paper); the
 * row stays as the record, and its identity document is no longer read. An unfiled document stays
 * unfiled; its file may be filed again.
 */
export const unfileDocument = defineCommand({
  name: 'documents.unfile',
  permission: 'documents.write',
  minScope: 'own',
  peopleOnly: true,
  input: UnfileDocumentInput,
  output: DocumentDto,
  auditFields: ['documentState', 'unfiledReason'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const d = schema.documents;
    const [row] = await ctx.tx
      .select()
      .from(d)
      .where(and(eq(d.id, input.documentId), eq(d.entityId, input.entityId)))
      .limit(1)
      .for('update');
    if (!row) {
      throw new DomainError('not_found', `document ${input.documentId} is not readable`, {
        reason: 'document_missing',
      });
    }
    if (row.unfiledAt !== null) {
      throw new DomainError('conflict', `document ${row.id} is already unfiled`, {
        reason: 'document_already_unfiled',
      });
    }
    const [updated] = await ctx.tx
      .update(d)
      .set({ unfiledAt: ctx.now, unfiledBy: ctx.principal.id, unfiledReason: input.reason })
      .where(eq(d.id, row.id))
      .returning();
    if (!updated) {
      throw new DomainError('not_found', `document ${row.id} is not yours to unfile`, {
        reason: 'document_missing',
      });
    }
    ctx.audit({
      aggregateType: 'document',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { documentState: 'filed' },
      after: { documentState: 'unfiled', unfiledReason: input.reason },
    });
    // The identity document follows its document off the record.
    return toDocumentDto(updated);
  },
});

/**
 * `documents.view`: opening a document's masked copy. Opening a sensitive one is audited
 * (DATABASE §4.3); the screen then signs a short-lived address for the file.
 */
export const viewDocument = defineCommand({
  name: 'documents.view',
  permission: 'documents.read',
  minScope: 'own',
  peopleOnly: true,
  input: ViewDocumentInput,
  output: DocumentViewDto,
  auditFields: ['documentKind', 'sensitive'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const document = await readDocument(ctx.tx, input.documentId);
    if (document?.entityId !== input.entityId) {
      throw new DomainError('not_found', `document ${input.documentId} is not readable`, {
        reason: 'document_missing',
      });
    }
    if (document.sensitive) {
      ctx.audit({
        aggregateType: 'document',
        aggregateId: document.id,
        entityId: document.entityId,
        after: { documentKind: document.kind, sensitive: true },
      });
    }
    return { documentId: document.id, fileId: document.fileId, sensitive: document.sensitive };
  },
});

/**
 * `documents.requirement.set` (an Executive: `documents.write` for every company): adds a
 * requirement to a flow's step in a company, or changes one. A requirement is turned off rather
 * than removed, so the seed never brings back one an Executive took away.
 */
export const setDocumentRequirement = defineCommand({
  name: 'documents.requirement.set',
  permission: 'documents.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetDocumentRequirementInput,
  output: DocumentRequirementDto,
  auditFields: [
    'flow',
    'stepKey',
    'requirementKey',
    'mandatory',
    'acceptedKinds',
    'position',
    'active',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const r = schema.documentRequirements;
    const [before] = await ctx.tx
      .select()
      .from(r)
      .where(
        and(
          eq(r.entityId, input.entityId),
          eq(r.flow, input.flow),
          eq(r.stepKey, input.stepKey),
          eq(r.requirementKey, input.requirementKey),
        ),
      )
      .limit(1)
      .for('update');
    const settings = {
      mandatory: input.mandatory,
      acceptedKinds: [...input.acceptedKinds],
      position: input.position,
      active: input.active,
    };
    const [row] =
      before === undefined
        ? await ctx.tx
            .insert(r)
            .values({
              id: newId(),
              entityId: input.entityId,
              flow: input.flow,
              stepKey: input.stepKey,
              requirementKey: input.requirementKey,
              ...settings,
              createdBy: ctx.principal.id,
              updatedBy: ctx.principal.id,
            })
            .returning()
        : await ctx.tx
            .update(r)
            .set({ ...settings, updatedBy: ctx.principal.id })
            .where(eq(r.id, before.id))
            .returning();
    if (!row) throw new DomainError('internal', 'requirement write returned no row');
    const keyed = {
      flow: input.flow,
      stepKey: input.stepKey,
      requirementKey: input.requirementKey,
    };
    ctx.audit({
      aggregateType: 'document_requirement',
      aggregateId: row.id,
      entityId: row.entityId,
      before:
        before === undefined
          ? null
          : {
              ...keyed,
              mandatory: before.mandatory,
              acceptedKinds: before.acceptedKinds,
              position: before.position,
              active: before.active,
            },
      after: { ...keyed, ...settings },
    });
    return toRequirementDto(row);
  },
});
