import { redactText } from '../ports/redaction';
import { maskIdentityNumbers } from './identity-numbers';

// Text on its way to a language model (SECURITY §5, AGENTS §9): no Aadhaar or bank account digits
// beyond the last four, no phone number beyond its last four, no email or UPI address. The
// provider wrapper passes every text through here before a call; a street address never reaches
// it, because callers send the fields a run needs and an address is not one of them.

/** `text` as a model may read it. */
export function maskForModel(text: string): string {
  return redactText(maskIdentityNumbers(text).text);
}

/**
 * Data a person outside the business wrote or sent (a customer message, an upload's text, a call
 * transcript), labelled as data so a model reads it as data and never as instructions (BLUEPRINT
 * §7.8, SECURITY §6). Angle brackets inside are escaped, so the data cannot close its own label.
 */
export function labelUntrusted(source: string, text: string): string {
  const safeSource = source.replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
  const escaped = maskForModel(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<untrusted_data source="${safeSource}">\n${escaped}\n</untrusted_data>`;
}
