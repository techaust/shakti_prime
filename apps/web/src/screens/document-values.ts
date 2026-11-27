import type { DocumentFlow, DocumentKind, DocumentRequirementKey } from '@shakti/contracts';

// J3 customer documents and requirements: the contract values the browser reads, copied here, in
// a file of their own so only the screens that name a document carry them (the catalogue page,
// which shares contract-values.ts, stays within its JavaScript budget). `contract-values.test.ts`
// keeps each equal to the contracts.
/** What a filed document is, in the order the Documents tab offers them. */
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
] as const satisfies readonly DocumentKind[];

/** The identity and bank papers, read only with `documents.sensitive.read`. */
export const SENSITIVE_DOCUMENT_KINDS = [
  'identity_proof',
  'bank_proof',
] as const satisfies readonly DocumentKind[];

/** The requirements a step can ask for, each with its label in the catalogue. */
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
] as const satisfies readonly DocumentRequirementKey[];

/** A project's flows. */
export const DOCUMENT_FLOWS = ['standard', 'surya_ghar'] as const satisfies readonly DocumentFlow[];

/** The steps of each flow, in the order the flow takes them. */
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

/** Every step of any flow, each with its label in the catalogue. */
export const DOCUMENT_STEPS = [
  'survey',
  'dispatch',
  'install',
  'commission',
  'handover',
  'load_enhancement',
  'portal_registration',
  'feasibility',
  'agreement',
  'material',
  'installation',
  'qc',
  'net_metering',
  'dbt_tracking',
] as const;
