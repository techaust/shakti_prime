import { describe, expect, it } from 'vitest';
import { baseFacts, NOW, QUOTE_ID } from '../../../tests/fixtures/copilot-sets';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { copilotTextProblem } from './filter';
import {
  buildBriefPrompt,
  buildSummaryPrompt,
  COPILOT_BRIEF_SYSTEM,
  COPILOT_NEXT_STEP_EXAMPLES,
  COPILOT_SUMMARY_SYSTEM,
  dueTemplates,
} from './prompt';

const DAY_MS = 86_400_000;

describe('the Caller Co-pilot’s prompts', () => {
  it('makes the same prompt from the same facts', () => {
    expect(buildBriefPrompt(baseFacts('brief'))).toEqual(buildBriefPrompt(baseFacts('brief')));
  });

  it('gives a brief the business’s rules and a summary the outcome codes and the transcript', () => {
    const brief = buildBriefPrompt(baseFacts('brief'));
    expect(brief.model).toBe(AGENT_DEFAULTS.copilot.briefModel);
    expect(brief.question).toContain('Ask the bore depth first');
    expect(brief.untrusted).toEqual([]);
    const summary = buildSummaryPrompt(baseFacts('call_summary', { transcript: 'Bore 120 feet.' }));
    expect(summary.model).toBe(AGENT_DEFAULTS.copilot.summaryModel);
    expect(summary.question).toContain('- interested: Interested, call back');
    expect(summary.untrusted).toEqual([{ source: 'call_transcript', text: 'Bore 120 feet.' }]);
  });

  it('reads the end of a long transcript only', () => {
    const long = `${'a'.repeat(AGENT_DEFAULTS.copilot.transcriptCharsRead)}THE END`;
    const [part] = buildSummaryPrompt(baseFacts('call_summary', { transcript: long })).untrusted;
    expect(part?.text.length).toBe(AGENT_DEFAULTS.copilot.transcriptCharsRead);
    expect(part?.text.endsWith('THE END')).toBe(true);
  });

  it('offers a template only on its day, with a chat and the consent it needs', () => {
    const chat = { chat: true, consents: { service: true, promotional: false } };
    expect(dueTemplates(baseFacts('brief', { whatsapp: chat }))).toEqual([]);
    const expiring = baseFacts('brief', {
      whatsapp: chat,
      quotes: [
        { label: 'Q1', quoteId: QUOTE_ID, validUntil: new Date(NOW.getTime() + 2 * DAY_MS) },
      ],
    });
    // The utility template only: the marketing one needs a promotional consent, and the
    // platform's welcome is never offered.
    expect(dueTemplates(expiring)).toEqual([
      '- season_checkin (Checking in): occasion quote_expiry, quote Q1',
    ]);
    expect(dueTemplates({ ...expiring, whatsapp: { ...chat, chat: false } })).toEqual([]);
    const later = baseFacts('brief', {
      whatsapp: chat,
      quotes: [
        { label: 'Q1', quoteId: QUOTE_ID, validUntil: new Date(NOW.getTime() + 3 * DAY_MS) },
      ],
    });
    expect(dueTemplates(later)).toEqual([]);
  });

  it('asks for next steps in words the output filter keeps', () => {
    // Its examples are notes the filter keeps, and both prompts name the phrasing it refuses.
    expect(COPILOT_NEXT_STEP_EXAMPLES.length).toBeGreaterThan(0);
    for (const example of COPILOT_NEXT_STEP_EXAMPLES) {
      expect({ example, problem: copilotTextProblem(example) }).toEqual({
        example,
        problem: undefined,
      });
      expect(COPILOT_BRIEF_SYSTEM).toContain(example);
    }
    for (const system of [COPILOT_BRIEF_SYSTEM, COPILOT_SUMMARY_SYSTEM]) {
      expect(system).not.toMatch(/what the caller should do/i);
      for (const refused of ['"you should"', '"you must"', '"you are"']) {
        expect(system).toContain(refused);
      }
    }
  });
});
