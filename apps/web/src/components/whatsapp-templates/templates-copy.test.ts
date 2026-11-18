import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';

describe('Settings › WhatsApp templates says only what is true now (review 9)', () => {
  it('sends a company with no fitting template to the people who register one, not to a screen', () => {
    // No screen registers a template yet: it is recorded by the team that sets up WhatsApp.
    expect(en.whatsappTemplates.noFit).toBe(
      'No template of this company fits this update. Ask the team that sets up WhatsApp to register one that does.',
    );
  });
});
