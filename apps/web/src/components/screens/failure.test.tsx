import { Field, Input } from '@shakti/ui';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import { useFieldFailure } from './failure';
import type { CommandFailure } from './use-command';

function PhoneForm({ failure }: { failure: CommandFailure | undefined }) {
  const { fieldError } = useFieldFailure(failure, ['phone']);
  return (
    <Field id="lead-phone" label="Phone" error={fieldError('phone')}>
      <Input name="phone" />
    </Field>
  );
}

function render(failure: CommandFailure | undefined) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <PhoneForm failure={failure} />
    </NextIntlClientProvider>,
  );
}

describe('a failure the server gives a field (WEB-2)', () => {
  it('is read out as an alert under the field it is about', () => {
    const html = render({ error: 'phone_invalid', field: 'phone', attempt: 1 });
    expect(html).toContain(`<span role="alert">${en.errors.phone_invalid}</span>`);
    expect(html).toContain('id="lead-phone-error"');
    expect(html).toMatch(/<input[^>]*\bid="lead-phone"/);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
  });

  it('shows nothing when no failure belongs to the field', () => {
    expect(render(undefined)).not.toContain('role="alert"');
    expect(render({ error: 'internal', attempt: 1 })).not.toContain('role="alert"');
  });
});
