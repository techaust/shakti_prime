import { CreateLeadInput } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { SEGMENTS } from './contract-values';
import { buildWalkInInput, WALK_IN_KINDS, walkInProblem, type WalkInFields } from './walk-in';

const base: WalkInFields = {
  entityId: '1',
  pipelineKey: 'farmer_pumps',
  segment: 'farmer_pumps',
  name: 'Ramesh Patil',
  phone: '98220 12345',
  language: '',
  village: '',
  pin: '',
  referralCode: '',
  consent: undefined,
};

describe('buildWalkInInput', () => {
  it('makes a lead the contract accepts, with the walk-in source and the kinds its interest implies', () => {
    const input = buildWalkInInput(base);
    expect(CreateLeadInput.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      entityId: 1,
      sourceCode: 'walk_in',
      account: { type: 'farm' },
      contact: { name: 'Ramesh Patil', phone: '98220 12345' },
    });
    expect(input).not.toHaveProperty('site');
    expect(input).not.toHaveProperty('referralCode');
    expect(input).not.toHaveProperty('consent');
  });

  it('sends the village with its PIN as the site, and a trimmed referral code', () => {
    const input = buildWalkInInput({
      ...base,
      village: ' Ozar ',
      pin: '422206',
      referralCode: ' ab12 ',
    });
    expect(input).toMatchObject({
      site: { type: 'borewell', village: 'Ozar', pin: '422206' },
      referralCode: 'ab12',
    });
    expect(CreateLeadInput.safeParse(input).success).toBe(true);
  });

  it('sends the chosen language for calls, and Hinglish when none is chosen', () => {
    expect(buildWalkInInput(base)).toMatchObject({ contact: { preferredLanguage: 'hinglish' } });
    expect(buildWalkInInput({ ...base, language: 'en' })).toMatchObject({
      contact: { preferredLanguage: 'en' },
    });
  });

  it('sends no site for a dealer, whose enquiry has no site of its own', () => {
    const input = buildWalkInInput({
      ...base,
      pipelineKey: 'dealer_wholesale',
      segment: 'dealer_wholesale',
      village: 'Ozar',
    });
    expect(input).not.toHaveProperty('site');
    expect(input).toMatchObject({ account: { type: 'dealer' } });
  });

  it('records a ticked consent as given at the walk-in form', () => {
    const input = buildWalkInInput({
      ...base,
      consent: { textVersion: 'v1', channel: 'call', purpose: 'service' },
    });
    expect(input).toMatchObject({
      consent: { textVersion: 'v1', channel: 'call', purpose: 'service', source: 'walk_in_form' },
    });
    expect(CreateLeadInput.safeParse(input).success).toBe(true);
  });

  it('leaves the kind of customer empty until an interest is chosen, so the command names it', () => {
    const input = buildWalkInInput({ ...base, pipelineKey: '', segment: undefined });
    expect(CreateLeadInput.safeParse(input).success).toBe(false);
  });

  it('knows a kind of customer for every business line', () => {
    expect(Object.keys(WALK_IN_KINDS).sort()).toEqual([...SEGMENTS].sort());
  });
});

describe('walkInProblem', () => {
  it('asks for the village when only a PIN is typed', () => {
    expect(walkInProblem({ village: '', pin: '422206' })).toBe('villageNeeded');
    expect(walkInProblem({ village: 'Ozar', pin: '422206' })).toBeUndefined();
    expect(walkInProblem({ village: ' ', pin: ' ' })).toBeUndefined();
  });
});
