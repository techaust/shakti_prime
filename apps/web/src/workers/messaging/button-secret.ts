/**
 * `WHATSAPP_BUTTON_SECRET` (docs/03-roadmap-appendix/phase2.md §7.1): the secret a quote's
 * WhatsApp buttons and a one-time code are made with; undefined while it is not set, when no quote
 * goes by WhatsApp. A hosted runtime refuses a short one (`productionConfigProblems()`).
 */
export function whatsappButtonSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const secret = env.WHATSAPP_BUTTON_SECRET ?? '';
  return secret === '' ? undefined : secret;
}
