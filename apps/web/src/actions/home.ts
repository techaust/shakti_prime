'use server';

import type {
  CallerHomeDto,
  CreditHomeDto,
  PipelineStagesDto,
  ResponseTimeDto,
  SalesHomeDto,
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
import { requestMeta, signedInIn } from './support';

/**
 * The reads of the home page's sections (docs/03-roadmap-appendix/phase1.md §9): thin wrappers over
 * the home queries, each run once in each company it is asked for. The query checks the grant its
 * section needs; a person who lacks it gets the failure message in that section's place.
 */

/**
 * Runs a section's read once in each company given, as the person acts in that company (their
 * grants and team there, not the intersection of "All companies"), and puts the answers together:
 * every read answers one entry per company of its request.
 */
async function inEach<T>(
  name: string,
  entityIds: readonly number[],
  query: (context: Parameters<Parameters<typeof executeQuery>[2]>[0]) => Promise<T[]>,
): Promise<T[]> {
  const { requestId } = await requestMeta();
  const parts = await Promise.all(
    entityIds.map(async (entityId) => {
      const principal = await signedInIn(entityId);
      return executeQuery(principal, { entityIds: [entityId], requestId }, query, { name });
    }),
  );
  return parts.flat();
}

/** The caller's queue summary and calls today. */
export async function homeCaller(
  entityIds: readonly number[],
): Promise<ActionResult<CallerHomeDto[]>> {
  return toResult('homeCaller', () =>
    inEach('homeCaller', entityIds, (context) => homeCallerQuery(context)),
  );
}

/** The open leads by stage of each pipeline. */
export async function homePipeline(
  entityIds: readonly number[],
): Promise<ActionResult<PipelineStagesDto[]>> {
  return toResult('homePipeline', () =>
    inEach('homePipeline', entityIds, (context) => homePipelineQuery(context)),
  );
}

/** First calls past their limit, per company. */
export async function homeResponseTimes(
  entityIds: readonly number[],
): Promise<ActionResult<ResponseTimeDto[]>> {
  return toResult('homeResponseTimes', () =>
    inEach('homeResponseTimes', entityIds, (context) => homeResponseTimesQuery(context)),
  );
}

/** Quotes and orders this month, per company. */
export async function homeSales(
  entityIds: readonly number[],
): Promise<ActionResult<SalesHomeDto[]>> {
  return toResult('homeSales', () =>
    inEach('homeSales', entityIds, (context) => homeSalesQuery(context)),
  );
}

/** Dealer credit, per company. */
export async function homeCredit(
  entityIds: readonly number[],
): Promise<ActionResult<CreditHomeDto[]>> {
  return toResult('homeCredit', () =>
    inEach('homeCredit', entityIds, (context) => homeCreditQuery(context)),
  );
}
