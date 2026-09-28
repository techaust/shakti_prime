import { newId, RealtimeTokenGrant } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { issueRealtimeToken } from '../../src/commands/realtime/issue-token';

afterAll(closeDb);

async function auditRows(requestId: string) {
  return asMigrator(
    (m) => m<
      {
        command: string;
        outcome: string;
        aggregate_type: string | null;
        aggregate_id: string | null;
        entity_id: number | null;
        after_json: Record<string, unknown> | null;
      }[]
    >`select command, outcome, aggregate_type, aggregate_id, entity_id, after_json
        from audit_logs where request_id = ${requestId}`,
  );
}

describe('realtime.token.issue', () => {
  it('is denied to an agent, which holds no profile.write', async () => {
    // principalFor, not createTestPrincipal: an agent principals row would change the agent count
    // the fail-closed suite checks.
    const agent = principalFor('agent:chief', [1]);
    await expect(
      asPrincipal(agent, (context) =>
        runCommand(issueRealtimeToken, { context, audit, outbox }, {}),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a voice session even for a role that holds profile.write', async () => {
    const voice = await createTestPrincipal('field_engineer', [1], { kind: 'voice_session' });
    const requestId = newId();
    await expect(
      executeCommand(voice, { entityIds: [1], requestId }, issueRealtimeToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await auditRows(requestId)).map((r) => r.outcome)).toEqual(['denied']);
  });

  it('refuses a company outside the caller’s, and names only the companies of the request', async () => {
    const person = await createTestPrincipal('tele_caller_cc', [1, 2]);
    await expect(
      executeCommand(person, { entityIds: [3] }, issueRealtimeToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const narrowed = await executeCommand(person, { entityIds: [2] }, issueRealtimeToken, {});
    expect(narrowed.entity_ids).toEqual([2]);
  });

  it('refuses any field in the input', async () => {
    const person = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(
      executeCommand(person, { entityIds: [1] }, issueRealtimeToken, { entity_ids: [2] }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('settles the claims for the caller and writes one audit row with the token id', async () => {
    const person = await createTestPrincipal('field_engineer', [2, 1, 2]);
    const requestId = newId();
    const grant = await executeCommand(
      person,
      { entityIds: [2, 1], requestId },
      issueRealtimeToken,
      {},
      { client: { ip: '10.0.7.1', device: 'field tablet' } },
    );
    expect(RealtimeTokenGrant.parse(grant)).toEqual({
      jti: grant.jti,
      sub: person.id,
      bos_role: 'field_engineer',
      entity_ids: [1, 2],
    });
    expect(await auditRows(requestId)).toEqual([
      {
        command: 'realtime.token.issue',
        outcome: 'ok',
        aggregate_type: 'realtime_token',
        aggregate_id: grant.jti,
        entity_id: null,
        after_json: { entityIds: [1, 2], bosRole: 'field_engineer' },
      },
    ]);
    // Each call is a new token with its own id.
    const again = await executeCommand(person, { entityIds: [1] }, issueRealtimeToken, {});
    expect(again.jti).not.toBe(grant.jti);
  });
});
