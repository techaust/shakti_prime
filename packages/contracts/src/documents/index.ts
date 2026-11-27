import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';

/*
 * J3 Customer documents and requirements (docs/03-roadmap-appendix/phase4.md §6.3, SECURITY §5).
 * A customer's document is a masked, clean `customer_document` file filed against one of the
 * customer's requirements; an identity document keeps only the last four digits of its number.
 */

/** What a filed document is. A kind in `SENSITIVE_DOCUMENT_KINDS` is read only with `documents.sensitive.read`. */
export const DOCUMENT_KINDS = [
  'electricity_bill',
  'identity_proof',
  'property_papers',
  'site_photo',
  'sanctioned_load_letter',
  'agreement',
  'commissioning_report',
  'net_meter_certificate',
  'bank_proof',
] as const;
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

/** Identity and bank papers (phase4 §6.3): read only with `documents.sensitive.read`. */
export const SENSITIVE_DOCUMENT_KINDS = [
  'identity_proof',
  'bank_proof',
] as const satisfies readonly DocumentKind[];

export function isSensitiveKind(kind: DocumentKind): boolean {
  return (SENSITIVE_DOCUMENT_KINDS as readonly string[]).includes(kind);
}

/**
 * The requirements a step can ask for (the workshop's PROJ-1 list, phase4 §10). Each has its
 * label in the message catalogue, so the list is closed: a new requirement is a code change.
 */
export const DOCUMENT_REQUIREMENT_KEYS = [
  'electricity_bill',
  'identity_proof',
  'property_papers',
  'site_photos',
  'sanctioned_load_letter',
  'agreement',
  'commissioning_report',
  'net_meter_certificate',
  'bank_proof',
] as const;
export const DocumentRequirementKeySchema = z.enum(DOCUMENT_REQUIREMENT_KEYS);
export type DocumentRequirementKey = z.infer<typeof DocumentRequirementKeySchema>;

/** A project's flow (phase4 §5): the standard install flow or PM Surya Ghar. */
export const DOCUMENT_FLOWS = ['standard', 'surya_ghar'] as const;
export const DocumentFlowSchema = z.enum(DOCUMENT_FLOWS);
export type DocumentFlow = z.infer<typeof DocumentFlowSchema>;

/**
 * The steps of each flow a requirement can belong to: the standard checklist (BLUEPRINT §8.5,
 * `STANDARD_MILESTONES`) and the PM Surya Ghar stages (`project-surya-ghar`).
 */
export const DOCUMENT_STEP_KEYS = {
  standard: ['survey', 'dispatch', 'install', 'commission', 'handover'],
  surya_ghar: [
    'survey',
    'load_enhancement',
    'portal_registration',
    'feasibility',
    'agreement',
    'material',
    'installation',
    'qc',
    'net_metering',
    'dbt_tracking',
  ],
} as const satisfies Record<DocumentFlow, readonly string[]>;
export const DOCUMENT_STEPS = [
  ...new Set<string>([...DOCUMENT_STEP_KEYS.standard, ...DOCUMENT_STEP_KEYS.surya_ghar]),
] as readonly string[];
export const DocumentStepKeySchema = z
  .string()
  .refine((step) => DOCUMENT_STEPS.includes(step), { message: 'not a step of any flow' });

/** Who filed a document: a person, or the classifier above its threshold (J7). */
export const DOCUMENT_FILED_BY_KINDS = ['person', 'classifier'] as const;
export const DocumentFiledByKindSchema = z.enum(DOCUMENT_FILED_BY_KINDS);
export type DocumentFiledByKind = z.infer<typeof DocumentFiledByKindSchema>;

/** The number an identity document carries; only its last four digits are ever kept. */
export const IDENTITY_DOCUMENT_KINDS = ['aadhaar', 'pan', 'bank_proof'] as const;
export const IdentityDocumentKindSchema = z.enum(IDENTITY_DOCUMENT_KINDS);
export type IdentityDocumentKind = z.infer<typeof IdentityDocumentKindSchema>;

/** Four digits: all of an identity number that is kept. */
export const LastFourSchema = z.string().regex(/^[0-9]{4}$/);

/** Why a document was taken off its requirement: plain words, kept with it. */
export const UnfileReasonSchema = z.string().trim().min(3).max(300);

/**
 * `documents.document.file`: a checked `customer_document` file, uploaded for this customer, filed against
 * one of the customer's requirements (or none, as a loose document of a kind).
 */
export const FileDocumentInput = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema,
    fileId: IdSchema,
    kind: DocumentKindSchema,
    requirementKey: DocumentRequirementKeySchema.nullable(),
  })
  .strict();
export type FileDocumentInput = z.infer<typeof FileDocumentInput>;

/** `documents.document.unfile`: the document leaves its requirement, with the reason; the row stays. */
export const UnfileDocumentInput = z
  .object({ entityId: EntityIdSchema, documentId: IdSchema, reason: UnfileReasonSchema })
  .strict();
export type UnfileDocumentInput = z.infer<typeof UnfileDocumentInput>;

/** `documents.document.view`: opening a document's masked copy, audited (DATABASE §4.3). */
export const ViewDocumentInput = z
  .object({ entityId: EntityIdSchema, documentId: IdSchema })
  .strict();
export type ViewDocumentInput = z.infer<typeof ViewDocumentInput>;

/**
 * `documents.requirement.set` (an Executive): one requirement of a flow's step in a company,
 * added or changed. A requirement is turned off rather than removed, so the seed never brings
 * back one an Executive took away.
 */
export const SetDocumentRequirementInput = z
  .object({
    entityId: EntityIdSchema,
    flow: DocumentFlowSchema,
    stepKey: DocumentStepKeySchema,
    requirementKey: DocumentRequirementKeySchema,
    mandatory: z.boolean(),
    acceptedKinds: z
      .array(DocumentKindSchema)
      .min(1)
      .max(DOCUMENT_KINDS.length)
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: 'a kind is listed twice',
      }),
    position: z.number().int().min(1).max(99),
    active: z.boolean(),
  })
  .strict()
  .refine((v) => (DOCUMENT_STEP_KEYS[v.flow] as readonly string[]).includes(v.stepKey), {
    message: 'the step is not one of the flow',
    path: ['stepKey'],
  });
export type SetDocumentRequirementInput = z.infer<typeof SetDocumentRequirementInput>;

/** A requirement of a step. Strict. */
export const DocumentRequirementDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    flow: DocumentFlowSchema,
    stepKey: z.string(),
    requirementKey: DocumentRequirementKeySchema,
    mandatory: z.boolean(),
    acceptedKinds: z.array(DocumentKindSchema),
    position: z.number().int(),
    active: z.boolean(),
  })
  .strict();
export type DocumentRequirementDto = z.infer<typeof DocumentRequirementDto>;

/**
 * A filed document as its reader sees it. A sensitive one reaches only a holder of
 * `documents.sensitive.read`; `lastFour` is the identity number's last four digits, set only on
 * such a document. Strict.
 */
export const DocumentDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    accountId: IdSchema,
    projectId: IdSchema.nullable(),
    requirementKey: DocumentRequirementKeySchema.nullable(),
    kind: DocumentKindSchema,
    fileId: IdSchema,
    sensitive: z.boolean(),
    filedByKind: DocumentFiledByKindSchema,
    confidence: z.number().min(0).max(1).nullable(),
    filedAt: z.iso.datetime({ offset: true }),
    unfiledAt: z.iso.datetime({ offset: true }).nullable(),
    unfiledReason: z.string().nullable(),
    lastFour: z
      .array(z.object({ kind: IdentityDocumentKindSchema, lastFour: LastFourSchema }).strict())
      .max(12),
  })
  .strict();
export type DocumentDto = z.infer<typeof DocumentDto>;

/** What opening a document needs: its masked file, which the screen signs an address for. */
export const DocumentViewDto = z
  .object({ documentId: IdSchema, fileId: IdSchema, sensitive: z.boolean() })
  .strict();
export type DocumentViewDto = z.infer<typeof DocumentViewDto>;

/**
 * The workshop's default requirements per flow and step (PROJ-1, phase4 §10, from BLUEPRINT §8.5):
 * the seed writes each for every company once, and an Executive changes them in Settings ›
 * Document requirements. `WORKSHOP_DEFAULTS.documents.requirements` names the same list.
 */
export const WORKSHOP_DOCUMENT_REQUIREMENTS: readonly {
  flow: DocumentFlow;
  stepKey: string;
  requirementKey: DocumentRequirementKey;
  mandatory: boolean;
  acceptedKinds: readonly DocumentKind[];
  position: number;
}[] = [
  // The standard install flow: survey → dispatch → install → commission → handover.
  {
    flow: 'standard',
    stepKey: 'survey',
    requirementKey: 'electricity_bill',
    mandatory: true,
    acceptedKinds: ['electricity_bill'],
    position: 1,
  },
  {
    flow: 'standard',
    stepKey: 'survey',
    requirementKey: 'identity_proof',
    mandatory: true,
    acceptedKinds: ['identity_proof'],
    position: 2,
  },
  {
    flow: 'standard',
    stepKey: 'survey',
    requirementKey: 'site_photos',
    mandatory: true,
    acceptedKinds: ['site_photo'],
    position: 3,
  },
  {
    flow: 'standard',
    stepKey: 'survey',
    requirementKey: 'property_papers',
    mandatory: false,
    acceptedKinds: ['property_papers'],
    position: 4,
  },
  {
    flow: 'standard',
    stepKey: 'commission',
    requirementKey: 'commissioning_report',
    mandatory: true,
    acceptedKinds: ['commissioning_report'],
    position: 1,
  },
  // PM Surya Ghar: survey → load enhancement → registration → feasibility → agreement → material
  // → installation → QC → net metering → DBT.
  {
    flow: 'surya_ghar',
    stepKey: 'survey',
    requirementKey: 'electricity_bill',
    mandatory: true,
    acceptedKinds: ['electricity_bill'],
    position: 1,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'survey',
    requirementKey: 'identity_proof',
    mandatory: true,
    acceptedKinds: ['identity_proof'],
    position: 2,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'survey',
    requirementKey: 'site_photos',
    mandatory: true,
    acceptedKinds: ['site_photo'],
    position: 3,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'survey',
    requirementKey: 'property_papers',
    mandatory: true,
    acceptedKinds: ['property_papers'],
    position: 4,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'feasibility',
    requirementKey: 'sanctioned_load_letter',
    mandatory: true,
    acceptedKinds: ['sanctioned_load_letter'],
    position: 1,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'agreement',
    requirementKey: 'agreement',
    mandatory: true,
    acceptedKinds: ['agreement'],
    position: 1,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'installation',
    requirementKey: 'commissioning_report',
    mandatory: true,
    acceptedKinds: ['commissioning_report'],
    position: 1,
  },
  {
    flow: 'surya_ghar',
    stepKey: 'net_metering',
    requirementKey: 'net_meter_certificate',
    mandatory: true,
    acceptedKinds: ['net_meter_certificate'],
    position: 1,
  },
];

/** A customer's documents in one company, for the Documents section of Account 360. */
export const ListCustomerDocumentsInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema })
  .strict();
export type ListCustomerDocumentsInput = z.infer<typeof ListCustomerDocumentsInput>;

/** One company's requirements, for Settings › Document requirements. */
export const ListDocumentRequirementsInput = z.object({ entityId: EntityIdSchema }).strict();
export type ListDocumentRequirementsInput = z.infer<typeof ListDocumentRequirementsInput>;

/**
 * The Documents section: the customer's documents the caller may read (filed and unfiled, newest
 * first), the company's active requirements, and what the caller may do. Strict.
 */
export const CustomerDocumentsDto = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema,
    documents: z.array(DocumentDto),
    requirements: z.array(DocumentRequirementDto),
    /**
     * Each step's mandatory requirements with no filed document yet (`app.documents_missing()`),
     * which counts an identity paper the caller may not read as filed.
     */
    missing: z.array(
      z
        .object({
          flow: DocumentFlowSchema,
          stepKey: z.string(),
          requirementKeys: z.array(DocumentRequirementKeySchema),
        })
        .strict(),
    ),
    /** Holds `documents.write`: may upload, file and unfile within its scope. */
    canFile: z.boolean(),
    /** Holds `documents.sensitive.read`: may file and open identity and bank papers. */
    canFileSensitive: z.boolean(),
  })
  .strict();
export type CustomerDocumentsDto = z.infer<typeof CustomerDocumentsDto>;
