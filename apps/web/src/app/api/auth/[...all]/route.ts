import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../auth/auth';

export const dynamic = 'force-dynamic';

/** Better Auth's routes (sign-in, sign-out, password reset, two-factor). Server actions call the same API in-process. */
export const { GET, POST } = toNextJsHandler(auth);
