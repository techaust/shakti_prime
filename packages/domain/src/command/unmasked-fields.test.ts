import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { uploadKey } from '../files/limits';
import { maskInputIdentity, maskTypedIdentity } from '../privacy/input-masking';
import { commands, getCommand } from './registry';

/** A valid Aadhaar number (its Verhoeff check digit is 4). */
const AADHAAR = '234567890124';
/** 91 and a mobile number whose twelve digits are a valid Aadhaar number too. */
const MOBILE_91 = '919876543216';
/** A SHA-256 in hexadecimal with a valid Aadhaar number among its digits. */
const HEX = `ab${AADHAAR}${'c'.repeat(50)}`;

interface ZodNode {
  _zod: { def: { type: string } & Record<string, unknown> };
}

/** The schema of the field at a dot path, arrays passed through, or undefined when it has none. */
function fieldAt(schema: z.ZodType, path: string): z.ZodType | undefined {
  const step = (node: ZodNode, keys: readonly string[]): ZodNode | undefined => {
    const def = node._zod.def;
    const inner = (name: string) => def[name] as ZodNode;
    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'readonly':
      case 'catch':
      case 'nonoptional':
        return step(inner('innerType'), keys);
      case 'pipe':
        // A field parsed then transformed (a phone) is the whole pipe.
        if (keys.length === 0) return node;
        return step(inner('in'), keys) ?? step(inner('out'), keys);
      case 'array':
        return step(inner('element'), keys);
      case 'union':
        for (const option of def.options as ZodNode[]) {
          const found = step(option, keys);
          if (found !== undefined) return found;
        }
        return undefined;
      case 'object': {
        const [key, ...rest] = keys;
        if (key === undefined) return node;
        const field = (def.shape as Record<string, ZodNode | undefined>)[key];
        return field === undefined ? undefined : step(field, rest);
      }
      default:
        return keys.length === 0 ? node : undefined;
    }
  };
  return step(schema as unknown as ZodNode, path.split('.')) as z.ZodType | undefined;
}

/**
 * The fields under a schema, each at its own path: an object's fields at any depth, arrays and
 * wrappers passed through; a field that is no object is its own one leaf.
 */
function leavesOf(schema: z.ZodType, at = ''): { path: string; schema: z.ZodType }[] {
  const node = schema as unknown as ZodNode;
  const def = node._zod.def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return leavesOf(def.innerType as z.ZodType, at);
    case 'array':
      return leavesOf(def.element as z.ZodType, at);
    case 'object':
      return Object.entries(def.shape as Record<string, z.ZodType>).flatMap(([key, field]) =>
        leavesOf(field, at === '' ? key : `${at}.${key}`),
      );
    default:
      return [{ path: at, schema }];
  }
}

/**
 * For every field a command leaves whole, a value it holds by design that the masker would change:
 * the proof that the field needs its exemption. A new exemption brings its example here, and its
 * schema must refuse free text (`FREE_TEXT`), so a person can never type a note into it.
 */
const EXEMPT_EXAMPLES: Record<string, Record<string, unknown>> = {
  'org.entity.update': {
    'bankDetails.accountNumber': AADHAAR,
    upiId: `${MOBILE_91}@okaxis`,
  },
  // A WhatsApp phone_number_id is a long number; an Aadhaar-shaped one stays whole.
  'org.channel.set': { providerRef: AADHAAR },
  // WhatsApp's ids for a company number, a customer number and a message stay whole.
  'messaging.inbound.record': {
    phoneNumberId: AADHAAR,
    waId: MOBILE_91,
    providerMessageId: `wamid.${AADHAAR}`,
  },
  'messaging.status.record': { providerMessageId: `wamid.${AADHAAR}` },
  'messaging.message.record_send': { providerMessageId: `wamid.${AADHAAR}` },
  'catalogue.item.create': { sku: AADHAAR },
  'catalogue.item.update': { sku: AADHAAR },
  'catalogue.kit.create': { sku: AADHAAR },
  'catalogue.kit.update': { sku: AADHAAR },
  'files.upload.begin': { sha256: HEX },
  'files.upload.complete': { 'stored.sha256': HEX },
  'files.file.mark_ready': { 'stored.sha256': HEX },
  'files.document.record': { sha256: HEX },
  'knowledge.playbook.record_check': { wordingSha256: HEX },
  'admin.role.permissions.set': { expectedVersion: HEX },
  'crm.lead.create': { referralCode: AADHAAR },
  'crm.enquiry.take': { referralCode: AADHAAR },
  'crm.referral_partner.set': { code: AADHAAR },
  'crm.referral_partner.create': { code: AADHAAR },
  'crm.commission_rule.set': { amount: AADHAAR },
  'crm.contact.update': { email: `${MOBILE_91}@gmail.com` },
  'admin.user.invite': { email: `${MOBILE_91}@gmail.com` },
  'notifications.push.subscribe': {
    endpoint: `https://fcm.googleapis.com/fcm/send/${AADHAAR}`,
    'keys.p256dh': `B${AADHAAR}${'x'.repeat(80)}`,
    'keys.auth': `a${AADHAAR}bcd`,
  },
  'notifications.push.unsubscribe': { endpoint: `https://fcm.googleapis.com/fcm/send/${AADHAAR}` },
  // A cell of a phone column, which the command's own masking keeps as the phone it is.
  'imports.job.create': { rows: MOBILE_91 },
};

/** What a person might type into a text field: never valid in a field left whole. */
const FREE_TEXT = 'Aadhaar 2345 6789 0124 near the well';

/**
 * The one exemption whose field takes free text: an import's cells, which `imports.job.create`
 * masks itself, knowing each column (`maskLongNumberCells()`: every Aadhaar-shaped number, valid
 * or not, except 91 and a mobile number in a column of phones).
 */
const MASKED_BY_THE_COMMAND = ['imports.job.create rows'];

/**
 * Free-text fields that hold a long number now and then, left masked on purpose: an all-digit
 * invoice number or a push address that passes the check digit loses all but its last four digits,
 * an accepted cost (docs/07-security.md §5).
 */
const MASKED_ON_PURPOSE: readonly { command: string; path: string }[] = [
  { command: 'sales.dealer_outstanding.record', path: 'oldestUnpaidInvoiceNo' },
  { command: 'notifications.push.record', path: 'gone' },
  { command: 'notifications.push.record', path: 'delivered' },
];

/**
 * Fields that hold a long number or a code by design and need no exemption: a valid value of each,
 * as the input schema parses it, comes through the masker unchanged.
 */
const KEPT_EXAMPLES: readonly { command: string; path: string; value: unknown }[] = [
  { command: 'org.entity.update', path: 'gstin', value: '08ABCDE1234F1Z5' },
  { command: 'org.entity.update', path: 'bankDetails.ifsc', value: 'SBIN0001234' },
  { command: 'org.entity.update', path: 'pin', value: '302001' },
  { command: 'crm.account.update', path: 'gstin', value: '08ABCDE1234F1Z5' },
  { command: 'tax.rate.set', path: 'hsn', value: '85414300' },
  { command: 'pricing.price.set', path: 'price', value: `${AADHAAR}.00` },
  { command: 'sales.dealer_terms.set', path: 'creditLimit', value: `${AADHAAR}.00` },
  { command: 'sales.dealer_outstanding.record', path: 'outstanding', value: `${AADHAAR}.00` },
  { command: 'catalogue.pump_curve.set', path: 'points.flowLph', value: '2345678901.24' },
  { command: 'admin.user.invite', path: 'phone', value: '+919876543216' },
  { command: 'crm.contact.update', path: 'addPhones.phone', value: MOBILE_91 },
  { command: 'crm.contact.update', path: 'addPhones.phone', value: '+91 98765 43216' },
  { command: 'crm.lead.create', path: 'contact.phone', value: MOBILE_91 },
  { command: 'crm.enquiry.route', path: 'phone', value: MOBILE_91 },
  {
    command: 'files.document.record',
    path: 'key',
    value: uploadKey(1, 'quote_pdf', `0190a1b2-c3d4-7e5f-8a9b-${AADHAAR}`, 'application/pdf'),
  },
  {
    command: 'crm.task.create',
    path: 'dueAt',
    value: '2026-11-09T15:45:30.123+05:30',
  },
  { command: 'crm.lead.anonymise', path: 'after.at', value: '2026-11-09T10:15:30.123456Z' },
  { command: 'sales.target.set', path: 'startsOn', value: '2026-11-01' },
];

const declared = Object.values(commands).flatMap((command) =>
  (command.unmaskedFields ?? []).map((path) => ({ command, path })),
);

describe('the fields the Aadhaar masking leaves whole (unmaskedFields)', () => {
  it('names only fields of the command input, each once', () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const { command, path } of declared) {
      expect(fieldAt(command.input, path), `${command.name}: ${path}`).toBeDefined();
    }
    for (const command of Object.values(commands)) {
      const fields = command.unmaskedFields ?? [];
      expect(new Set(fields).size, command.name).toBe(fields.length);
    }
  });

  it('refuses a path the input does not have', () => {
    const update = getCommand('org.entity.update');
    expect(fieldAt(update.input, 'bankDetails.accountNumber')).toBeDefined();
    expect(fieldAt(update.input, 'bankDetails.accountNo')).toBeUndefined();
    expect(fieldAt(update.input, 'accountNumber')).toBeUndefined();
    expect(fieldAt(update.input, 'brandName.length')).toBeUndefined();
  });

  it('has an example for every exemption, and none for a field that is not exempt', () => {
    const fromExamples = Object.entries(EXEMPT_EXAMPLES)
      .flatMap(([name, fields]) => Object.keys(fields).map((path) => `${name} ${path}`))
      .sort();
    const fromCommands = declared
      .flatMap(({ command, path }) => {
        const examples = Object.keys(EXEMPT_EXAMPLES[command.name] ?? {});
        // An exemption of an object covers its fields, each with its own example.
        const under = examples.filter((e) => e.startsWith(`${path}.`));
        return (under.length > 0 ? under : [path]).map((p) => `${command.name} ${p}`);
      })
      .sort();
    expect(fromExamples).toEqual(fromCommands);
  });

  it.each(
    Object.entries(EXEMPT_EXAMPLES).flatMap(([name, fields]) =>
      Object.entries(fields).map(([path, value]) => ({ name, path, value })),
    ),
  )(
    '$name leaves $path whole: the masker would change a valid value of it',
    ({ name, path, value }) => {
      const command = getCommand(name);
      const field = fieldAt(command.input, path);
      expect(field, path).toBeDefined();
      // Arrays are passed through, so an example is one value: one cell of the import's rows.
      const parsed = field?.safeParse(value);
      expect(parsed?.success, `${name} ${path}`).toBe(true);
      const text = String(value);
      expect(maskTypedIdentity(text).text).not.toBe(text);
      // Under the command's exemptions the whole parsed value comes through as it went in.
      const nested = path
        .split('.')
        .reverse()
        .reduce<unknown>((inner, key) => ({ [key]: inner }), parsed?.data);
      expect(maskInputIdentity(nested, command.unmaskedFields).value).toEqual(nested);
    },
  );

  it('leaves whole only fields whose schema refuses free text, every field under an object too', () => {
    for (const { command, path } of declared) {
      if (MASKED_BY_THE_COMMAND.includes(`${command.name} ${path}`)) continue;
      const field = fieldAt(command.input, path);
      expect(field, `${command.name} ${path}`).toBeDefined();
      if (field === undefined) continue;
      for (const leaf of leavesOf(field, path)) {
        expect(leaf.schema.safeParse(FREE_TEXT).success, `${command.name} ${leaf.path}`).toBe(
          false,
        );
      }
    }
    const imports = getCommand('imports.job.create');
    expect(fieldAt(imports.input, 'rows')?.safeParse(FREE_TEXT).success).toBe(true);
  });

  it('would refuse an exemption of an object that holds a free-text field', () => {
    // `unmaskedFields: ['bankDetails']` would leave the branch, typed by a person, whole.
    const bank = fieldAt(getCommand('org.entity.update').input, 'bankDetails');
    const keys = fieldAt(getCommand('notifications.push.subscribe').input, 'keys');
    if (bank === undefined || keys === undefined) throw new Error('the fields are missing');
    const free = leavesOf(bank, 'bankDetails')
      .filter((leaf) => leaf.schema.safeParse(FREE_TEXT).success)
      .map((leaf) => leaf.path);
    expect(free).toEqual(['bankDetails.bankName', 'bankDetails.branch']);
    // The push keys are an object whose every field refuses free text.
    expect(leavesOf(keys, 'keys').map((leaf) => leaf.path)).toEqual(['keys.p256dh', 'keys.auth']);
  });

  it.each(MASKED_ON_PURPOSE)(
    '$command masks $path, a free-text field',
    ({ command: name, path }) => {
      const command = getCommand(name);
      expect(command.unmaskedFields ?? []).not.toContain(path);
      expect(fieldAt(command.input, path)?.safeParse(FREE_TEXT).success).toBe(true);
    },
  );

  it.each(KEPT_EXAMPLES)(
    '$command keeps a valid $path through the masker: $value',
    ({ command: name, path, value }) => {
      const command = getCommand(name);
      expect(command.unmaskedFields ?? []).not.toContain(path);
      const parsed = fieldAt(command.input, path)?.safeParse(value);
      expect(parsed?.success, `${name} ${path}`).toBe(true);
      expect(maskInputIdentity(parsed?.data).value).toEqual(parsed?.data);
    },
  );
});
