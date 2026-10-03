/**
 * Names the signed-in principal, by id only, on this request's Sentry events. Without a DSN the
 * SDK is never loaded and nothing happens; a failure to tag never fails the request.
 */
export async function tagSentryPrincipal(principalId: string): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === '') return;
  try {
    const { tagPrincipal } = await import('./sentry-server');
    tagPrincipal(principalId);
  } catch {
    // Error reporting is a courtesy to the owner; the request goes on without it.
  }
}
