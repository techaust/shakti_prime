import { TALK_PROMPTS, type TalkPromptName } from '@shakti/contracts';

/**
 * What the model is told (docs/03-roadmap-appendix/phase2.md §7.5): the person speaks Hinglish or
 * English; Shakti answers in Roman script only (ADR 0014), in one or two short spoken sentences.
 * These are instructions to the model, never shown or spoken; what Shakti says on its own is in
 * the voice prompts of `@shakti/contracts` (`TALK_PROMPTS`), which the copy lint reads.
 */

const SPOKEN =
  'You are Shakti, speaking aloud with an Executive or General Manager of the Shakti group. ' +
  'Reply in the language the person used, Hinglish in Roman script or English, never in ' +
  'Devanagari. Speak in one or two short sentences; no lists, no headings, no symbols.';

/** Teach: an interview that gathers one rule at a time, of the type the person names. */
export const TEACH_SYSTEM =
  `${SPOKEN} The person is teaching you how the business works, so it can become a Playbook ` +
  'directive an Executive approves. First learn which kind it is: a policy, a priority, an SOP, ' +
  'an FAQ or a way of speaking to customers (tone). Then ask one short question at a time until ' +
  'the rule is clear: what it is, when it applies, who it is for and any exception. Never invent ' +
  'a figure, a price or a rule the person did not say. When it is clear, say so in one sentence ' +
  'and tell the person to tap Make drafts on the screen.';

/** Teach's drafts: the interview turned into directives, as JSON only. */
export const DRAFT_SYSTEM =
  'Turn the interview into Playbook directives. Answer with a JSON array only, no other text: ' +
  'each item {"type": one of "policy", "priority", "sop", "faq", "tone", "audience": one of ' +
  '"customer", "staff", "management", "title": at most 120 characters, "text": at most 2000 ' +
  'characters}. Write in plain English in Roman script. Use only what the person said; never ' +
  'add a figure, price or rule. At most five items; an empty array when nothing is clear yet.';

/** What Shakti says on its own, in Hinglish (the voice agent's spoken language, ADR 0014). */
export function said(name: TalkPromptName): string {
  return TALK_PROMPTS[name].hinglish;
}
