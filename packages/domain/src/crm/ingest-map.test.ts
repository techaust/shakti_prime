import { IdempotencyKeySchema } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  formQuestions,
  ingestIdempotencyKey,
  isTicked,
  mapFormAnswers,
  type FormAnswer,
  type SourceMapping,
} from './ingest-map';

const GIVEN = '2026-11-14T05:00:00.000Z';

const mapping: SourceMapping = {
  fieldMap: {
    full_name: 'fullName',
    first: 'firstName',
    last: 'lastName',
    phone_number: 'phone',
    zip: 'pin',
    city: 'village',
    depth: 'pumpDepthFt',
    hp: 'requiredHp',
    bill: 'monthlyBillRupees',
    consumer: 'discomConsumerNo',
    note: 'message',
  },
  consent: { questionKey: 'agree', textVersion: 'v1', channels: ['call'], purpose: 'service' },
};

const a = (key: string, value: string): FormAnswer => ({ key, label: null, value });

describe('mapFormAnswers', () => {
  it('reads the mapped questions into a lead, normalising the phone', () => {
    const out = mapFormAnswers(
      [
        a('full_name', '  Ramesh   Kumar '),
        a('phone_number', '098290 12345'),
        a('zip', '305 801'),
        a('city', 'Kishangarh'),
        a('depth', '1,200 feet'),
        a('hp', '7.5 HP'),
        a('bill', 'Rs 2,400'),
        a('consumer', 'JVVNL-1234/56'),
        a('note', 'Call after 5'),
        a('not_mapped', 'ignored'),
      ],
      mapping,
      GIVEN,
    );
    expect(out).toEqual({
      ok: true,
      contact: { name: 'Ramesh Kumar', phone: '+919829012345' },
      site: { pin: '305801', village: 'Kishangarh' },
      qualification: {
        pumpDepthFt: 1200,
        requiredHp: 7.5,
        monthlyBillRupees: 2400,
        discomConsumerNo: 'JVVNL-1234/56',
      },
      consent: undefined,
      message: 'Call after 5',
    });
  });

  it('joins a first and a last name, and records a consent only for a ticked consent question', () => {
    const base = [a('first', 'Sunita'), a('last', 'Devi'), a('phone_number', '+919829012345')];
    const ticked = mapFormAnswers([...base, a('agree', 'Yes')], mapping, GIVEN);
    expect(ticked).toMatchObject({
      ok: true,
      contact: { name: 'Sunita Devi' },
      consent: { channels: ['call'], purpose: 'service', textVersion: 'v1', givenAt: GIVEN },
    });
    for (const value of ['No', '', 'maybe', 'false']) {
      expect(mapFormAnswers([...base, a('agree', value)], mapping, GIVEN)).toMatchObject({
        ok: true,
        consent: undefined,
      });
    }
    expect(
      mapFormAnswers([...base, a('agree', 'yes')], { ...mapping, consent: null }, GIVEN),
    ).toMatchObject({ consent: undefined });
  });

  it('never guesses: no name or no readable phone is no lead, and a fact that does not read is left out', () => {
    expect(mapFormAnswers([a('phone_number', '+919829012345')], mapping, GIVEN)).toEqual({
      ok: false,
      missing: ['name'],
    });
    expect(
      mapFormAnswers([a('full_name', 'Ramesh'), a('phone_number', '12')], mapping, GIVEN),
    ).toEqual({ ok: false, missing: ['phone'] });
    const out = mapFormAnswers(
      [
        a('full_name', 'Ramesh'),
        a('phone_number', '+919829012345'),
        a('depth', 'very deep'),
        a('zip', '12'),
      ],
      mapping,
      GIVEN,
    );
    expect(out).toMatchObject({ ok: true, qualification: undefined, site: undefined });
  });
});

describe('isTicked, formQuestions and ingestIdempotencyKey', () => {
  it('knows a tick in English and Roman Hindi', () => {
    expect(['yes', 'TRUE', '1', 'I agree', 'haan'].every(isTicked)).toBe(true);
    expect(['no', 'nahin', '0', ''].some(isTicked)).toBe(false);
  });

  it('keeps each question once, with no answer', () => {
    expect(
      formQuestions([
        { key: 'FULL_NAME', label: 'Full Name', value: 'Ramesh' },
        { key: 'FULL_NAME', label: 'Full Name', value: 'again' },
      ]),
    ).toEqual([{ key: 'FULL_NAME', label: 'Full Name' }]);
  });

  it('makes one key per event, a UUID the runner takes', () => {
    const key = ingestIdempotencyKey('meta_ads', '444444444444');
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
    expect(ingestIdempotencyKey('meta_ads', '444444444444')).toBe(key);
    expect(ingestIdempotencyKey('google_ads', '444444444444')).not.toBe(key);
  });
});
