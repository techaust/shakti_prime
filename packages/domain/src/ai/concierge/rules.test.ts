import { describe, expect, it } from 'vitest';
import { handoffReasonOf, handoffRuleOf } from './rules';

// The rules that hand a chat to people before any model is asked (A3, design §7.2).

describe('handoffRuleOf', () => {
  it('reads HUMAN as the whole message, in any case and with punctuation', () => {
    expect(handoffRuleOf('HUMAN')).toBe('human');
    expect(handoffRuleOf('insaan se baat!')).toBe('human');
    // A sentence that only holds the keyword is the customer's own message.
    expect(handoffRuleOf('Is a human going to visit?')).toBeNull();
  });

  it('reads complaint and legal words anywhere, the legal matter first', () => {
    expect(handoffRuleOf('My pump is not working since Monday')).toBe('complaint');
    expect(handoffRuleOf('motor kharab ho gaya')).toBe('complaint');
    expect(handoffRuleOf('I will go to the consumer forum, this is a complaint')).toBe('legal');
    expect(handoffRuleOf('Mera vakil baat karega')).toBe('legal');
  });

  it('reads a question of price or of subsidy', () => {
    expect(handoffRuleOf('What is the price of a 5 HP pump?')).toBe('price');
    expect(handoffRuleOf('5 hp ka kitna lagega')).toBe('price');
    expect(handoffRuleOf('Is there a subsidy under PM Kusum?')).toBe('subsidy');
    expect(handoffRuleOf('sarkari yojana milegi kya')).toBe('subsidy');
  });

  it('holds words whole, so a word inside another is not one', () => {
    expect(handoffRuleOf('Please call me separately tomorrow')).toBeNull();
    expect(handoffRuleOf('My bore is 180 ft deep')).toBeNull();
    expect(handoffRuleOf('accurate reading')).toBeNull();
  });

  it('meets nothing in a file without words or an empty message', () => {
    expect(handoffRuleOf(null)).toBeNull();
    expect(handoffRuleOf('  !! ')).toBeNull();
  });

  it('reads the words it is given', () => {
    const words = { complaint: [], legal: [], price: ['bhav'], subsidy: [] };
    expect(handoffRuleOf('aaj ka bhav?', words)).toBe('price');
    expect(handoffRuleOf('What is the price?', words)).toBeNull();
  });
});

describe('handoffReasonOf', () => {
  it('gives each cause its thread reason', () => {
    expect(handoffReasonOf('human')).toBe('keyword');
    expect(handoffReasonOf('asked_for_person')).toBe('request');
    expect(handoffReasonOf('complaint')).toBe('complaint');
    expect(handoffReasonOf('legal')).toBe('complaint');
    expect(handoffReasonOf('refusals')).toBe('filter_refusals');
    for (const cause of ['price', 'subsidy', 'out_of_scope', 'low_confidence', 'other'] as const) {
      expect(handoffReasonOf(cause)).toBe('question');
    }
  });
});
