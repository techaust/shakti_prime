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
import { requestMeta, signedIn } from './support';

/**
 * The reads of the home page's sections (docs/03-roadmap-appendix/phase1.md §9): thin wrappers over
 * the home queries, each across the companies of the request. The query checks the grant its
 * section needs; a person who lacks it gets the failure message in that section's place.
 */

/** The caller's queue summary and calls today. */
export async function homeCaller(): Promise<ActionResult<CallerHomeDto[]>> {
  return toResult('homeCaller', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => homeCallerQuery(context), {
      name: 'homeCaller',
    });
  });
}

/** The open leads by stage of each pipeline. */
export async function homePipeline(): Promise<ActionResult<PipelineStagesDto[]>> {
  return toResult('homePipeline', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => homePipelineQuery(context), {
      name: 'homePipeline',
    });
  });
}

/** First calls past their limit, per company. */
export async function homeResponseTimes(): Promise<ActionResult<ResponseTimeDto[]>> {
  return toResult('homeResponseTimes', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => homeResponseTimesQuery(context), {
      name: 'homeResponseTimes',
    });
  });
}

/** Quotes and orders this month, per company. */
export async function homeSales(): Promise<ActionResult<SalesHomeDto[]>> {
  return toResult('homeSales', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => homeSalesQuery(context), {
      name: 'homeSales',
    });
  });
}

/** Dealer credit, per company. */
export async function homeCredit(): Promise<ActionResult<CreditHomeDto[]>> {
  return toResult('homeCredit', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => homeCreditQuery(context), {
      name: 'homeCredit',
    });
  });
}
