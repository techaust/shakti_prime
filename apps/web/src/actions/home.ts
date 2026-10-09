'use server';

import {
  DomainError,
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
 * holds companies. `name` is the section's own query name for the slow-query log.
 */
async function inEach<T>(
  section: HomeSection,
  name: string,
  query: (context: Parameters<Parameters<typeof executeQuery>[2]>[0]) => Promise<T[]>,
): Promise<T[]> {
  const entityIds = await sessionSectionEntities(section);
  const { requestId } = await requestMeta();
  const parts = await Promise.all(
    entityIds.map(async (entityId) => {
      const principal = await signedInIn(entityId);
      return executeQuery(principal, { entityIds: [entityId], requestId }, query, { name });
    }),
  );
  return parts.flat();
}

/** The caller's queue summary and calls today, in the companies where the person is a caller. */
export async function homeCaller(): Promise<ActionResult<CallerHomeDto[]>> {
  return toResult('homeCaller', () =>
    inEach('caller', 'homeCaller', (context) => homeCallerQuery(context)),
  );
}

/**
 * The open leads by stage of each pipeline, for the General Manager's or the Executive's
 * companies. Anything but those two sections is refused.
 */
export async function homePipeline(
  section: unknown,
): Promise<ActionResult<PipelineStagesDto[]>> {
  return toResult('homePipeline', () => {
    if (section !== 'manager' && section !== 'executive') {
      throw new DomainError('validation_failed', 'invalid section');
    }
    return inEach(section, 'homePipeline', (context) => homePipelineQuery(context));
  });
}

/** First calls past their limit, per company of the General Manager. */
export async function homeResponseTimes(): Promise<ActionResult<ResponseTimeDto[]>> {
  return toResult('homeResponseTimes', () =>
    inEach('manager', 'homeResponseTimes', (context) => homeResponseTimesQuery(context)),
  );
}

/** Quotes and orders this month, per company of the Executive. */
export async function homeSales(): Promise<ActionResult<SalesHomeDto[]>> {
  return toResult('homeSales', () =>
    inEach('executive', 'homeSales', (context) => homeSalesQuery(context)),
  );
}

/** Dealer credit, per company of Accounts. */
export async function homeCredit(): Promise<ActionResult<CreditHomeDto[]>> {
  return toResult('homeCredit', () =>
    inEach('accounts', 'homeCredit', (context) => homeCreditQuery(context)),
  );
}
