import {
  PinCodeImportRowInput,
  type ImportRowErrorDto,
  type PinCodeImportField,
  type PinCodeImportMapping,
} from '@shakti/contracts';
import { gstStateCode } from './gst-states';

/** What the preview found for one row of the India Post directory. */
export type PinCodeRowCheck =
  | { state: 'valid'; input: PinCodeImportRowInput; key: string; errors: [] }
  | { state: 'invalid'; input: null; key: null; errors: ImportRowErrorDto[] };

const FIELD_OF_PATH: Readonly<Record<string, PinCodeImportField>> = {
  pin: 'pin',
  officeName: 'officeName',
  taluk: 'taluk',
  district: 'district',
  stateCode: 'state',
};

/** Spaces as one, so `Sikar  S.O` and `Sikar S.O` are one office. */
function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The office a row names, for spotting it twice in one file: its PIN and its name in lower case. */
export function pinOfficeKey(input: Pick<PinCodeImportRowInput, 'pin' | 'officeName'>): string {
  return `${input.pin}\u0000${input.officeName.toLowerCase()}`;
}

/**
 * Checks one row of the India Post directory (PRD CRM-02): a six-digit PIN, the office's name and
 * district, and the taluk and state when the file has them. The state is a name (`RAJASTHAN`) or
 * a two-digit GST state code; one neither is refused.
 */
export function checkPinCodeRow(
  raw: Readonly<Record<string, string>>,
  mapping: PinCodeImportMapping,
): PinCodeRowCheck {
  const cell = (field: PinCodeImportField): string | undefined => {
    const column = mapping.columns[field];
    const value = column === undefined ? '' : tidy(raw[column] ?? '');
    return value === '' ? undefined : value;
  };
  const errors = new Map<string, ImportRowErrorDto>();
  const add = (error: ImportRowErrorDto) => {
    if (!errors.has(error.field)) errors.set(error.field, error);
  };

  const state = cell('state');
  const stateCode = state === undefined ? undefined : gstStateCode(state);
  if (state !== undefined && stateCode === undefined)
    add({ field: 'state', code: 'state_unknown' });
  const taluk = cell('taluk');
  const candidate: Record<string, unknown> = {
    pin: cell('pin'),
    officeName: cell('officeName'),
    district: cell('district'),
    ...(taluk === undefined ? {} : { taluk }),
    ...(stateCode === undefined ? {} : { stateCode }),
  };
  const parsed = PinCodeImportRowInput.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF_PATH[String(issue.path[0])] ?? 'row';
      if (candidate[String(issue.path[0])] === undefined) add({ field, code: 'required' });
      else if (issue.code === 'too_big') add({ field, code: 'too_long' });
      else add({ field, code: 'invalid' });
    }
  }
  if (!parsed.success || errors.size > 0) {
    return { state: 'invalid', input: null, key: null, errors: [...errors.values()] };
  }
  return { state: 'valid', input: parsed.data, key: pinOfficeKey(parsed.data), errors: [] };
}

/**
 * A post office's name as a village: the directory adds the office's class (`Sikar H.O`,
 * `Dhod S.O`, `Rasidpura B.O`), which a village name never carries.
 */
export function localityName(officeName: string): string {
  return tidy(officeName.replace(/\s+[BSH]\.?\s?O\.?$/i, '')) || tidy(officeName);
}
