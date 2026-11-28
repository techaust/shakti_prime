import {
  ConnectorBatchRequest,
  ConnectorHeartbeatRequest,
  ConnectorSnapshotRequest,
  connectorSigningString,
  isConnectorTimestampFresh,
  type ConnectorBatchResponse,
} from '@shakti/contracts';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the BOS's connector routes (docs/06-api.md §3.5), for the connector's tests. It
 * verifies every signature as `apps/web/src/integrations/tally/signature.ts` does, keeps a cursor
 * per company, refuses a batch that does not start at it (`cursor_mismatch`), and stores each
 * `Idempotency-Key` with its answer, replaying it for the same body and refusing another body
 * (`idempotency_mismatch`). Every voucher version it applies is recorded, so a test can prove
 * nothing was applied twice. Knobs take it down, lose answers after applying, or hold batches.
 */

export interface Applied {
  company: string;
  guid: string;
  alterId: number;
}

export interface StubKnobs {
  /** Every call fails on the network, as when the BOS or the office's internet is down. */
  down: boolean;
  /** The next N batch or snapshot answers (a replay too) are cut off after the BOS applied it. */
  loseAnswers: number;
  /**
   * Batches wait until `release()`: `before` they are applied (a kill then loses the call), or
   * `after` (a kill then loses only the answer).
   */
  holdBatches: false | 'before' | 'after';
  /** Batches of these companies are refused with this status (403: the company is not mapped). */
  refuseBatchesOf: Map<string, number>;
  /** Snapshots are refused with this status (413: a body over the platform's body limit). */
  refuseSnapshots: number | undefined;
  /** The next N answers to any call are a 200 the connector cannot read, before anything applies. */
  garbleNext: number;
  /** The next N answers to a batch (a replay too) are a 200 it cannot read, after the BOS applied it. */
  garbleBatchAnswers: number;
  /** Every answer carries fields the connector does not know, as a later BOS would. */
  extraFields: boolean;
}

interface Stored {
  bodyHash: string;
  status: number;
  answer: unknown;
}

export class StubBos {
  readonly knobs: StubKnobs = {
    down: false,
    loseAnswers: 0,
    holdBatches: false,
    refuseBatchesOf: new Map(),
    refuseSnapshots: undefined,
    garbleNext: 0,
    garbleBatchAnswers: 0,
    extraFields: false,
  };
  readonly cursors = new Map<string, number>();
  readonly applied: Applied[] = [];
  /** Each accepted batch's range, in the order applied. */
  readonly batches: { company: string; from: number; to: number; key: string }[] = [];
  readonly snapshots: ConnectorSnapshotRequest[] = [];
  readonly heartbeats: ConnectorHeartbeatRequest[] = [];
  readonly refusedSignatures: string[] = [];
  /** Every raw body the stub received, to check what leaves the PC. */
  readonly bodies: string[] = [];
  /** Every call, by method and path, in the order received. */
  readonly calls: string[] = [];
  private readonly keys = new Map<string, Stored>();
  private readonly held: (() => void)[] = [];
  private readonly heldWaiters: (() => void)[] = [];
  private server: Server | undefined;
  url = '';

  constructor(
    readonly connectorId: string,
    private readonly key: string,
  ) {}

  async start(port = 0): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server?.listen(port, '127.0.0.1', resolve));
    const address = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${String(address.port)}`;
  }

  async close(): Promise<void> {
    this.release();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (this.server === undefined) {
        resolve();
        return;
      }
      this.server.close(() => {
        resolve();
      });
    });
  }

  /** Resolves when a batch is being held. */
  waitForHeldBatch(): Promise<void> {
    if (this.held.length > 0) return Promise.resolve();
    return new Promise((resolve) => this.heldWaiters.push(resolve));
  }

  release(): void {
    this.knobs.holdBatches = false;
    for (const go of this.held.splice(0)) go();
  }

  /** How many times each voucher version was applied. */
  appliedTwice(): Applied[] {
    const seen = new Set<string>();
    return this.applied.filter((a) => {
      const id = `${a.guid}@${String(a.alterId)}`;
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });
  }

  private verify(request: IncomingMessage, pathWithQuery: string, body: string): boolean {
    const timestamp = String(request.headers['x-timestamp'] ?? '');
    const signature = String(request.headers['x-signature'] ?? '');
    if (request.headers['x-connector-id'] !== this.connectorId) return false;
    if (!isConnectorTimestampFresh(timestamp, Math.floor(Date.now() / 1000))) return false;
    const expected = createHmac('sha256', this.key)
      .update(
        connectorSigningString({
          method: request.method ?? '',
          pathWithQuery,
          timestamp,
          bodySha256Hex: createHash('sha256').update(body).digest('hex'),
        }),
      )
      .digest('hex');
    return (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    if (this.knobs.down) {
      request.socket.destroy();
      return;
    }
    this.bodies.push(body);
    const pathWithQuery = request.url ?? '';
    const send = (status: number, answer: unknown) => {
      response
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(status === 200 ? this.later(answer) : answer));
    };
    const refuse = (status: number, code: string, reason?: string) => {
      send(status, {
        error: {
          code,
          message: 'Refused by the stub.',
          ...(reason === undefined ? {} : { details: { reason } }),
          requestId: 'stub',
        },
      });
    };
    if (!this.verify(request, pathWithQuery, body)) {
      this.refusedSignatures.push(pathWithQuery);
      refuse(401, 'unauthorized');
      return;
    }
    const url = new URL(pathWithQuery, 'http://stub');
    this.calls.push(`${request.method ?? ''} ${url.pathname}`);
    if (this.knobs.garbleNext > 0) {
      this.knobs.garbleNext -= 1;
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"company":');
      return;
    }
    switch (`${request.method ?? ''} ${url.pathname}`) {
      case 'GET /api/v1/connector/tally/cursor': {
        const company = url.searchParams.get('company') ?? '';
        send(200, {
          company,
          lastAlterId: this.cursors.get(company) ?? 0,
          updatedAt: this.cursors.has(company) ? new Date().toISOString() : null,
        });
        return;
      }
      case 'POST /api/v1/connector/tally/heartbeat': {
        const parsed = ConnectorHeartbeatRequest.safeParse(JSON.parse(body));
        if (!parsed.success) {
          refuse(400, 'validation_failed');
          return;
        }
        this.heartbeats.push(parsed.data);
        send(200, {
          serverTime: new Date().toISOString(),
          latestVersion: '0.1.0',
          updateAvailable: false,
        });
        return;
      }
      case 'POST /api/v1/connector/tally/batches': {
        const company = (JSON.parse(body) as { company?: string }).company ?? '';
        const refusal = this.knobs.refuseBatchesOf.get(company);
        if (refusal !== undefined) {
          refuse(refusal, 'forbidden');
          return;
        }
        const hold = this.knobs.holdBatches;
        if (hold === 'before' && (await this.hold(request)) === 'closed') return;
        const key = String(request.headers['idempotency-key'] ?? '');
        await this.idempotent(
          request,
          response,
          body,
          () => this.applyBatch(body, key),
          hold === 'after',
          'batch',
        );
        return;
      }
      case 'POST /api/v1/connector/tally/snapshot':
        if (this.knobs.refuseSnapshots !== undefined) {
          // The platform's own refusal, before the route: plain text, not the BOS's envelope.
          response
            .writeHead(this.knobs.refuseSnapshots, { 'content-type': 'text/plain' })
            .end('Request Entity Too Large');
          return;
        }
        await this.idempotent(request, response, body, () => {
          const parsed = ConnectorSnapshotRequest.safeParse(JSON.parse(body));
          if (!parsed.success)
            return {
              status: 400,
              answer: { error: { code: 'validation_failed', message: 'x', requestId: 'stub' } },
            };
          this.snapshots.push(parsed.data);
          return {
            status: 200,
            answer: {
              company: parsed.data.company,
              known: parsed.data.voucherGuids.length,
              tombstoned: 0,
              missingOnServer: [],
            },
          };
        });
        return;
      default:
        refuse(404, 'not_found');
    }
  }

  /** Holds a call until `release()`, or until its caller goes away (`closed`). */
  private hold(request: IncomingMessage): Promise<'released' | 'closed'> {
    return new Promise((resolve) => {
      const go = () => {
        request.socket.off('close', gone);
        resolve('released');
      };
      const gone = () => {
        this.held.splice(this.held.indexOf(go), 1);
        resolve('closed');
      };
      request.socket.once('close', gone);
      this.held.push(go);
      for (const waiter of this.heldWaiters.splice(0)) waiter();
    });
  }

  /** Calls held now. */
  heldCount(): number {
    return this.held.length;
  }

  private async idempotent(
    request: IncomingMessage,
    response: ServerResponse,
    body: string,
    apply: () => { status: number; answer: unknown },
    holdAnswer = false,
    kind: 'batch' | 'snapshot' = 'snapshot',
  ): Promise<void> {
    const key = String(request.headers['idempotency-key'] ?? '');
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const stored = this.keys.get(key);
    let outcome: { status: number; answer: unknown };
    if (stored !== undefined) {
      outcome =
        stored.bodyHash === bodyHash
          ? stored
          : {
              status: 409,
              answer: {
                error: {
                  code: 'conflict',
                  message: 'x',
                  details: { reason: 'idempotency_mismatch' },
                  requestId: 'stub',
                },
              },
            };
    } else {
      outcome = apply();
      // A call that failed stores no key, so its retry runs again (docs/06-api.md §1).
      if (outcome.status === 200) this.keys.set(key, { bodyHash, ...outcome });
    }
    if (holdAnswer && (await this.hold(request)) === 'closed') return;
    if (outcome.status === 200 && kind === 'batch' && this.knobs.garbleBatchAnswers > 0) {
      this.knobs.garbleBatchAnswers -= 1;
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"company":');
      return;
    }
    if (outcome.status === 200 && this.knobs.loseAnswers > 0) {
      this.knobs.loseAnswers -= 1;
      request.socket.destroy();
      return;
    }
    response
      .writeHead(outcome.status, { 'content-type': 'application/json' })
      .end(JSON.stringify(outcome.status === 200 ? this.later(outcome.answer) : outcome.answer));
  }

  /** With `extraFields`, an answer as a later BOS might give it: new fields at every level. */
  private later(answer: unknown): unknown {
    if (!this.knobs.extraFields || typeof answer !== 'object' || answer === null) return answer;
    const grown: Record<string, unknown> = { ...answer, addedLater: 'a field this build ignores' };
    if (typeof grown.accepted === 'object' && grown.accepted !== null) {
      grown.accepted = { ...grown.accepted, vouchersQueuedForAccounts: 0 };
    }
    return grown;
  }

  private applyBatch(body: string, key: string): { status: number; answer: unknown } {
    const parsed = ConnectorBatchRequest.safeParse(JSON.parse(body));
    if (!parsed.success) {
      return {
        status: 400,
        answer: { error: { code: 'validation_failed', message: 'x', requestId: 'stub' } },
      };
    }
    const batch = parsed.data;
    const cursor = this.cursors.get(batch.company) ?? 0;
    if (batch.fromAlterId !== cursor) {
      return {
        status: 409,
        answer: {
          error: {
            code: 'conflict',
            message: 'x',
            details: { reason: 'cursor_mismatch' },
            requestId: 'stub',
          },
        },
      };
    }
    let vouchersNew = 0;
    let vouchersChanged = 0;
    for (const voucher of batch.vouchers) {
      const before = this.applied.some((a) => a.guid === voucher.guid);
      this.applied.push({ company: batch.company, guid: voucher.guid, alterId: voucher.alterId });
      if (before) vouchersChanged += 1;
      else vouchersNew += 1;
    }
    this.cursors.set(batch.company, batch.maxAlterId);
    this.batches.push({
      company: batch.company,
      from: batch.fromAlterId,
      to: batch.maxAlterId,
      key,
    });
    const answer: ConnectorBatchResponse = {
      company: batch.company,
      accepted: {
        vouchersNew,
        vouchersChanged,
        vouchersUnchanged: 0,
        ledgers: batch.ledgers.length,
      },
      lastAlterId: batch.maxAlterId,
    };
    return { status: 200, answer };
  }
}
