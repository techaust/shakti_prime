// What the Caller Co-pilot journey (`e2e/copilot.spec.ts`) and its seed (`e2e/setup/copilot.ts`)
// agree on. No database code here, so the journey runs inside the Linux snapshot container too.
import type { ProjectName } from './support/users';

/**
 * The tele-caller's lead the Co-pilot journey works, one per project so the runs never share, made
 * afresh on every run in company 1 with a brief written two hours ago, the summary of a recorded
 * call not saved yet (its outcome suggested), and two suggestions that need approval: the facts
 * heard on the call and a follow-up for the caller. Synthetic text for the journeys alone.
 */
export const COPILOT_LEADS: Record<ProjectName, string> = {
  'desktop-light': 'Bhagirath Meena',
  'desktop-dark': 'Sukhdev Gurjar',
  phone: 'Ramniwas Saini',
};

export const COPILOT_JOURNEY = {
  brief:
    'Asked about a 5 HP solar pump on the last call. Ask the bore depth and the water level, then offer a site visit.',
  summary:
    'The bore is 180 feet deep and the farmer wants a 7.5 HP pump. He asked for a call back tomorrow morning.',
  /** The facts the summary heard, as the panel shows them. */
  facts: { pumpDepthFt: 180, requiredHp: 7.5 },
  followUp: 'Call back about the pump quote',
} as const;
