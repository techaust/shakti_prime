import { describe, expect, it } from 'vitest';
import { pickConverter, qualifiesAsConverter, type ConverterCandidate } from './handover';

const lead = { language: 'hinglish', segment: 'farmer_pumps' } as const;

const person = (id: string, over: Partial<ConverterCandidate> = {}): ConverterCandidate => ({
  userId: id,
  isConverter: true,
  presence: 'present',
  maxOpen: null,
  languages: [],
  segments: [],
  openLeads: 0,
  ...over,
});

describe('qualifiesAsConverter', () => {
  it('needs the converter switch and presence', () => {
    expect(qualifiesAsConverter(person('a'), lead)).toBe(true);
    expect(qualifiesAsConverter(person('a', { isConverter: false }), lead)).toBe(false);
    expect(qualifiesAsConverter(person('a', { presence: 'away' }), lead)).toBe(false);
  });

  it('is full at the cap, free below it, and has no cap when null', () => {
    expect(qualifiesAsConverter(person('a', { maxOpen: 3, openLeads: 3 }), lead)).toBe(false);
    expect(qualifiesAsConverter(person('a', { maxOpen: 3, openLeads: 2 }), lead)).toBe(true);
    expect(qualifiesAsConverter(person('a', { maxOpen: null, openLeads: 900 }), lead)).toBe(true);
  });

  it('matches the language and the business line, and an empty list takes all', () => {
    expect(qualifiesAsConverter(person('a', { languages: ['en'] }), lead)).toBe(false);
    expect(qualifiesAsConverter(person('a', { languages: ['en', 'hinglish'] }), lead)).toBe(true);
    expect(qualifiesAsConverter(person('a', { segments: ['commercial_epc'] }), lead)).toBe(false);
    expect(qualifiesAsConverter(person('a', { segments: ['farmer_pumps'] }), lead)).toBe(true);
  });
});

describe('pickConverter', () => {
  it('answers null when nobody qualifies, or nobody is there', () => {
    expect(pickConverter([], lead, null)).toBeNull();
    expect(
      pickConverter(
        [person('a', { presence: 'away' }), person('b', { isConverter: false })],
        lead,
        null,
      ),
    ).toBeNull();
  });

  it('chooses the one with the fewest open leads', () => {
    const picked = pickConverter(
      [person('a', { openLeads: 4 }), person('b', { openLeads: 1 }), person('c', { openLeads: 2 })],
      lead,
      null,
    );
    expect(picked).toBe('b');
  });

  it('skips those who do not qualify, however few leads they hold', () => {
    const picked = pickConverter(
      [
        person('a', { openLeads: 0, presence: 'away' }),
        person('b', { openLeads: 0, languages: ['en'] }),
        person('c', { openLeads: 0, maxOpen: 0 }),
        person('d', { openLeads: 7 }),
      ],
      lead,
      null,
    );
    expect(picked).toBe('d');
  });

  it('breaks a tie in turn: the first after the cursor, then round to the first', () => {
    const all = [person('c'), person('a'), person('b')];
    expect(pickConverter(all, lead, null)).toBe('a');
    expect(pickConverter(all, lead, 'a')).toBe('b');
    expect(pickConverter(all, lead, 'b')).toBe('c');
    expect(pickConverter(all, lead, 'c')).toBe('a');
  });

  it('keeps a cursor that names someone no longer tied or present harmless', () => {
    const all = [person('b'), person('d')];
    expect(pickConverter(all, lead, 'c')).toBe('d');
    expect(pickConverter(all, lead, 'z')).toBe('b');
  });

  it('the cursor only orders ties: fewer open leads win over the next in turn', () => {
    const all = [
      person('a', { openLeads: 5 }),
      person('b', { openLeads: 5 }),
      person('c', { openLeads: 1 }),
    ];
    expect(pickConverter(all, lead, 'c')).toBe('c');
  });

  it('goes round a company evenly when each pick adds a lead', () => {
    const team = [person('a'), person('b'), person('c')];
    let cursor: string | null = null;
    const order: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = pickConverter(team, lead, cursor);
      if (id === null) throw new Error('nobody');
      order.push(id);
      cursor = id;
      const taker = team.find((p) => p.userId === id);
      if (taker) taker.openLeads += 1;
    }
    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
});
