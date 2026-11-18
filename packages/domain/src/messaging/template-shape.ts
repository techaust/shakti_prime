import {
  WHATSAPP_MILESTONE_SHAPES,
  WHATSAPP_MILESTONE_VALUES,
  WHATSAPP_PURPOSE_SHAPES,
  WHATSAPP_PURPOSE_VALUES,
  type WHATSAPP_LIVE_MILESTONES,
  type WhatsAppTemplateButton,
  type WhatsAppTemplatePurpose,
} from '@shakti/contracts';

// Whether a registered template can carry what the platform sends with it (docs/03-roadmap-
// appendix/phase2.md §7.1): Meta refuses a template message whose header or button values do not
// match the template as it was submitted, so a milestone is mapped, and a purpose registered, only
// on a template of the right category, header and buttons, taking exactly the right values.

/** A template as these rules read it. */
export interface TemplateParts {
  category: string;
  params: readonly unknown[];
  buttons: readonly Pick<WhatsAppTemplateButton, 'kind'>[];
  header: string;
  purpose: string | null;
}

const sameKinds = (
  buttons: readonly Pick<WhatsAppTemplateButton, 'kind'>[],
  kinds: readonly string[],
): boolean => buttons.length === kinds.length && buttons.every((b, i) => b.kind === kinds[i]);

/** Why a template cannot be mapped to a milestone, or null when it fits. */
export function milestoneMisfit(
  milestone: (typeof WHATSAPP_LIVE_MILESTONES)[number],
  template: TemplateParts,
): 'unfit' | 'values' | 'shape' | null {
  if (template.purpose !== null || template.category === 'authentication') return 'unfit';
  if (template.params.length !== WHATSAPP_MILESTONE_VALUES[milestone].length) return 'values';
  const shape = WHATSAPP_MILESTONE_SHAPES[milestone];
  if (template.header !== shape.header || !sameKinds(template.buttons, shape.buttons)) {
    return 'shape';
  }
  return null;
}

/** Why a template cannot be registered for a platform purpose, or null when it can. */
export function purposeMisfit(
  purpose: WhatsAppTemplatePurpose,
  template: Omit<TemplateParts, 'purpose'>,
): 'values' | 'shape' | null {
  if (template.params.length !== WHATSAPP_PURPOSE_VALUES[purpose].length) return 'values';
  const shape = WHATSAPP_PURPOSE_SHAPES[purpose];
  if (shape.category !== null && template.category !== shape.category) return 'shape';
  if (shape.header !== null && template.header !== shape.header) return 'shape';
  if (shape.buttons !== null && !sameKinds(template.buttons, shape.buttons)) return 'shape';
  return null;
}
