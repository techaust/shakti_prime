import { describe, expect, it } from 'vitest';
import { baseFacts, NOW, OWNER_ID } from '../../../tests/fixtures/concierge-sets';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { conciergeFilterFacts, leadFactLines } from './facts';
import { buildConciergePrompt, CONCIERGE_SYSTEM } from './prompt';

// The Concierge's prompt (A3, design §7.2): the same facts make the same prompt; the question holds
// the business's facts only, and every word the customer wrote, their name included, goes to the
// provider as data to be masked and labelled.

const said = (text: string) => ({ direction: 'inbound' as const, minutesAgo: 3, text });

describe('buildConciergePrompt', () => {
  const facts = baseFacts('farmer_pumps', [said('Bore 180 ft')], {
    current: { pumpDepthFt: 180, requiredHp: null },
    callbacks: [{ dueAt: new Date('2026-11-19T05:30:00Z') }],
    directives: [{ label: 'D1', type: 'faq', title: 'Hours', text: 'We answer from 9 to 7.' }],
  });

  it('is the same for the same facts, on the Concierge’s model and effort', () => {
    const prompt = buildConciergePrompt(facts);
    expect(buildConciergePrompt(facts)).toEqual(prompt);
    expect(prompt.model).toBe(AGENT_DEFAULTS.concierge.model);
    expect(prompt.effort).toBe(AGENT_DEFAULTS.concierge.effort);
    expect(prompt.system).toBe(CONCIERGE_SYSTEM);
  });

  it('gives the lead, its facts, its callbacks and the rules in the question', () => {
    const { question } = buildConciergePrompt(facts);
    expect(question).toContain('now: 2026-11-18 11:00 in India');
    expect(question).toContain('lead: Farmer Pumps (segment farmer_pumps), stage New');
    expect(question).toContain('facts recorded: depth of the bore (feet) 180');
    expect(question).toContain('facts still missing: power needed (HP)');
    expect(question).toContain('open callbacks: 2026-11-19 11:00 in India');
    expect(question).toContain('a callback can be booked: yes');
    expect(question).toContain('- D1 (faq) Hours: We answer from 9 to 7.');
  });

  it('puts the customer’s name and messages in the data, never in the question', () => {
    const prompt = buildConciergePrompt(facts);
    expect(prompt.question).not.toContain('Ramesh');
    expect(prompt.question).not.toContain('Bore 180 ft');
    expect(prompt.question).not.toContain(OWNER_ID);
    expect(prompt.untrusted).toEqual([
      { source: 'customer_name', text: 'Ramesh Kumar' },
      { source: 'business_message', text: '2 minutes ago: a WhatsApp template from the business' },
      { source: 'customer_message', text: '3 minutes ago: Bore 180 ft' },
    ]);
  });

  it('says no callback can be booked for a chat without a lead or an owner', () => {
    expect(buildConciergePrompt({ ...facts, ownerId: null }).question).toContain(
      'a callback can be booked: no',
    );
    expect(buildConciergePrompt({ ...facts, opportunityId: null, lead: null }).question).toContain(
      'lead: none open for this customer',
    );
  });
});

describe('conciergeFilterFacts', () => {
  it('grounds a reply on the customer’s words and the lead’s facts, never the business’s texts', () => {
    const facts = baseFacts('residential_rooftop', [said('Bill 4500')], {
      messages: [
        { direction: 'outbound', minutesAgo: 9, text: 'Your quote is [amount]' },
        said('Bill 4500'),
      ],
      current: { monthlyBillRupees: 4000 },
      callbacks: [{ dueAt: NOW }],
    });
    expect(leadFactLines(facts)).toEqual([
      'monthly electricity bill (rupees) 4000',
      'callback on 2026-11-18 11:00 in India',
    ]);
    expect(conciergeFilterFacts(facts).groundTexts).toEqual([
      'Bill 4500',
      'monthly electricity bill (rupees) 4000',
      'callback on 2026-11-18 11:00 in India',
    ]);
  });
});
