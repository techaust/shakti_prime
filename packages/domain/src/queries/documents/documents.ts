import {
  DocumentDto,
  DocumentRequirementDto,
  type DocumentFlow,
  type IdentityDocumentKind,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

type Tx = RequestContext['tx'];
type DocumentRow = typeof schema.documents.$inferSelect;
type RequirementRow = typeof schema.documentRequirements.$inferSelect;

/*
 * J3 customer documents (docs/03-roadmap-appendix/phase4.md §6.3). Every read runs under the
 * documents' row security: a sensitive document, and every identity document's last four digits,
 * reach only a holder of `documents.sensitive.read`.
 */

/** A document row as its strict DTO, with the last four digits of its identity numbers. */
export function toDocumentDto(
  row: DocumentRow,
  lastFour: readonly { kind: IdentityDocumentKind; lastFour: string }[] = [],
): DocumentDto {
  return DocumentDto.parse({
    id: row.id,
    entityId: row.entityId,
    accountId: row.accountId,
    projectId: row.projectId,
    requirementKey: row.requirementKey,
    kind: row.kind,
    fileId: row.fileId,
    sensitive: row.sensitive,
    filedByKind: row.filedByKind,
    confidence: row.confidence === null ? null : Number(row.confidence),
    filedAt: row.filedAt.toISOString(),
    unfiledAt: row.unfiledAt?.toISOString() ?? null,
    unfiledReason: row.unfiledReason,
    lastFour: row.sensitive ? lastFour : [],
  });
}

export function toRequirementDto(row: RequirementRow): DocumentRequirementDto {
  return DocumentRequirementDto.parse({
    id: row.id,
    entityId: row.entityId,
    flow: row.flow,
    stepKey: row.stepKey,
    requirementKey: row.requirementKey,
    mandatory: row.mandatory,
    acceptedKinds: row.acceptedKinds,
    position: row.position,
    active: row.active,
  });
}

/** The identity numbers' last four digits of the given documents, as the caller may read them. */
async function lastFourByDocument(
  tx: Tx,
  documentIds: readonly string[],
): Promise<Map<string, { kind: IdentityDocumentKind; lastFour: string }[]>> {
  const byDocument = new Map<string, { kind: IdentityDocumentKind; lastFour: string }[]>();
  if (documentIds.length === 0) return byDocument;
  const i = schema.identityDocuments;
  const rows = await tx
    .select({ documentId: i.documentId, kind: i.kind, last4: i.last4 })
    .from(i)
    .where(inArray(i.documentId, [...documentIds]))
    .orderBy(asc(i.createdAt), asc(i.id));
  for (const row of rows) {
    const list = byDocument.get(row.documentId) ?? [];
    list.push({ kind: row.kind as IdentityDocumentKind, lastFour: row.last4 });
    byDocument.set(row.documentId, list);
  }
  return byDocument;
}

/** The most documents a customer's list shows at once; older ones stay on record. */
export const CUSTOMER_DOCUMENTS_LIMIT = 200;

/**
 * A customer's documents in a company, filed and unfiled, newest first, on
 * `documents_account_filed_idx`. A document the caller may not read is not there.
 */
export async function listCustomerDocuments(
  ctx: RequestContext,
  input: { entityId: number; accountId: string },
): Promise<DocumentDto[]> {
  const d = schema.documents;
  const rows = await ctx.tx
    .select()
    .from(d)
    .where(and(eq(d.entityId, input.entityId), eq(d.accountId, input.accountId)))
    .orderBy(desc(d.filedAt), desc(d.id))
    .limit(CUSTOMER_DOCUMENTS_LIMIT);
  const lastFour = await lastFourByDocument(
    ctx.tx,
    rows.filter((r) => r.sensitive).map((r) => r.id),
  );
  return rows.map((row) => toDocumentDto(row, lastFour.get(row.id)));
}

/** One document as the caller may read it, or undefined. */
export async function readDocument(tx: Tx, documentId: string): Promise<DocumentDto | undefined> {
  const d = schema.documents;
  const [row] = await tx.select().from(d).where(eq(d.id, documentId)).limit(1);
  if (!row) return undefined;
  const lastFour = row.sensitive ? (await lastFourByDocument(tx, [row.id])).get(row.id) : [];
  return toDocumentDto(row, lastFour);
}

/** A company's requirements, of one flow or every flow, in step and position order. */
export async function listDocumentRequirements(
  ctx: RequestContext,
  input: { entityId: number; flow?: DocumentFlow },
): Promise<DocumentRequirementDto[]> {
  const r = schema.documentRequirements;
  const rows = await ctx.tx
    .select()
    .from(r)
    .where(
      and(
        eq(r.entityId, input.entityId),
        input.flow === undefined ? undefined : eq(r.flow, input.flow),
      ),
    )
    .orderBy(asc(r.flow), asc(r.stepKey), asc(r.position), asc(r.requirementKey));
  return rows.map(toRequirementDto);
}

/**
 * The completeness check (PRJ-03, `app.documents_missing()`): the mandatory requirement keys of a
 * step that the customer, or the project, has no filed document for, in position order. A step's
 * guard reads it; a sensitive document the caller cannot read still counts.
 */
export async function missingDocuments(
  tx: Tx,
  input: {
    entityId: number;
    accountId: string;
    projectId: string | null;
    flow: DocumentFlow;
    stepKey: string;
  },
): Promise<string[]> {
  const rows = (await tx.execute(
    sql`select app.documents_missing(${input.entityId}::smallint, ${input.accountId}::uuid,
                                     ${input.projectId}::uuid, ${input.flow}, ${input.stepKey})
               as missing`,
  )) as unknown as { missing: string[] }[];
  return rows[0]?.missing ?? [];
}
