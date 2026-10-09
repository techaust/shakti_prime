'use server';

import {
  DomainError,
  type Principal,
  type CallerHomeDto,
  type CreditHomeDto,
  type PipelineStagesDto,
  type ResponseTimeDto,
  type SalesHomeDto,
} from '@shakti/contracts';
import {
  executeQuery,
  homeCaller as homeCallerQuery,
  homeCredit as homeCreditQuery,
  homePipeline as homePipelineQuery,
  homeResponseTimes as homeResponseTimesQuery,
  homeSales as homeSalesQuery,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import type { HomeSection } from '../screens/home';
import { requestMeta, sessionSectionEntities, signedInIn } from './support';

/**
 * The reads of the home page's sections (docs/03-roadmap-appendix/phase1.md §9): thin wrappers over
 * the home queries, each run once in each company it is asked for. The query checks the grant its
 * section needs; a person who lacks it gets the failure message in that section's place.
 */

/**
 * Runs a section's read once in each company the session gives that section, as the person acts
 * in that company (their grants and team there, not the intersection of "All companies"), and puts
 * the answers together: every read answers one entry per company. The companies come from the
 * session, never from the caller's arguments, so no call opens more transactions than the person
 * holds companies. Each section's `run` names its own query for the slow-query log.
 */
async function inEach<T>(
  section: HomeSection,
  run: (principal: Principal, scope: { entityIds: number[]; requestId: string }) => Promise<T[]>,
): Promise<T[]> {
  const entityIds = await sessionSectionEntities(section);
  const { requestId } = await requestMeta();
  const parts = await Promise.all(
    entityIds.map(async (entityId) =>
      run(await signedInIn(entityId), { entityIds: [entityId], requestId }),
    ),
  );
  return parts.flat();
}

/** The caller's queue summary and calls today, in the companies where the person is a caller. */
export async function homeCaller(): Promise<ActionResult<CallerHomeDto[]>> {
  return toResult('homeCaller', () =>
    inEach('caller', (principal, scope) =>
      executeQuery(principal, scope, (context) => homeCallerQuery(context), {
        name: 'homeCaller',
      }),
    ),
  );
}

/**
 * The open leads by stage of each pipeline, for the General Manager's or the Executive's
 * companies. Anything but those two sections is refused.
 */
export async function homePipeline(section: unknown): Promise<ActionResult<PipelineStagesDto[]>> {
  return toResult('homePipeline', () => {
    if (section !== 'manager' && section !== 'executive') {
      throw new DomainError('validation_failed', 'invalid section');
    }
    return inEach(section, (principal, scope) =>
      executeQuery(principal, scope, (context) => homePipelineQuery(context), {
        name: 'homePipeline',
      }),
    );
  });
}

/** First calls past their limit, per company of the General Manager. */
export async function homeResponseTimes(): Promise<ActionResult<ResponseTimeDto[]>> {
  return toResult('homeResponseTimes', () =>
    inEach('manager', (principal, scope) =>
      executeQuery(principal, scope, (context) => homeResponseTimesQuery(context), {
        name: 'homeResponseTimes',
      }),
    ),
  );
}

/** Quotes and orders this month, per company of the Executive. */
export async function homeSales(): Promise<ActionResult<SalesHomeDto[]>> {
  return toResult('homeSales', () =>
    inEach('executive', (principal, scope) =>
      executeQuery(principal, scope, (context) => homeSalesQuery(context), {
        name: 'homeSales',
      }),
    ),
  );
}

/** Dealer credit, per company of Accounts. */
export async function homeCredit(): Promise<ActionResult<CreditHomeDto[]>> {
  return toResult('homeCredit', () =>
    inEach('accounts', (principal, scope) =>
      executeQuery(principal, scope, (context) => homeCreditQuery(context), {
        name: 'homeCredit',
      }),
    ),
  );
}
