import { newId, type Principal } from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  grantsForRole,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { inviteUser } from '../../src/commands/admin/invite-user';
import { createLead } from '../../src/commands/crm/create-lead';
import { listLeads } from '../../src/queries/crm/list-leads';

afterAll(closeDb);

const phone = () => `98${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const newCustomer = (entityId: number) => ({
  entityId,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Lead flow customer', phone: phone() },
  account: { type: 'farm' as const },
});

describe('a known customer and the colleague who looks after them (AUDIT M25)', () => {
  it('a second caller in the same company is routed to the colleague, not given a hidden lead', async () => {
    const owner = await createTestPrincipal('tele_caller_cc', [1]);
    const other = await createTestPrincipal('tele_caller_cc', [1]);
    const first = await asPrincipal(owner, (context) =>
      runCommand(createLead, { context, audit }, newCustomer(1)),
    );
    await expect(
      asPrincipal(other, (context) =>
        runCommand(
          createLead,
          { context, audit },
          { entityId: 1, pipelineKey: 'farmer_pumps', existingAccountId: first.account.id },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'customer_held_by_colleague' },
    });

    // the owner's own repeat enquiry goes through, as one more lead on the same customer
    const again = await asPrincipal(owner, (context) =>
      runCommand(
        createLead,
        { context, audit },
        { entityId: 1, pipelineKey: 'farmer_pumps', existingAccountId: first.account.id },
      ),
    );
    expect(again.account.id).toBe(first.account.id);
    const [links] = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from account_entities where account_id = ${first.account.id}`,
    );
    expect(links?.n).toBe(1);
  });
});

describe('the lead form keeps one customer shape (AUDIT M29)', () => {
  it('a known customer cannot be sent with a new contact or account', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(
          createLead,
          { context, audit },
          { ...newCustomer(1), existingAccountId: newId() },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('a lead is also a customer write (AUDIT L9)', () => {
  it('is refused to a principal that may write leads but not customers', async () => {
    const base = await createTestPrincipal('tele_caller_cc', [1]);
    const leadsOnly: Principal = {
      ...base,
      permissions: grantsForRole('tele_caller_cc').filter((g) => g.key !== 'crm.account.write'),
    };
    await expect(
      asPrincipal(leadsOnly, (context) =>
        runCommand(createLead, { context, audit }, newCustomer(1)),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { permission: 'crm.account.write' } });
  });
});

describe('All-companies mode and teams (AUDIT M24)', () => {
  it('a lead created for one company carries the caller team there', async () => {
    const team1 = await createTestTeam(1, 'multi-company team 1');
    const team2 = await createTestTeam(2, 'multi-company team 2');
    const caller = await createTestPrincipal('tele_caller_cc', [1, 2], {
      entityTeams: [
        { entityId: 1, teamId: team1 },
        { entityId: 2, teamId: team2 },
      ],
    });
    expect(caller.teamId).toBeUndefined();
    // as the lead action does: the request narrows to the lead's company
    const lead = await withRequestContext(caller, { entityIds: [2] }, (context) =>
      runCommand(createLead, { context, audit }, newCustomer(2)),
    );
    expect(lead.teamId).toBe(team2);
    const [row] = await asMigrator(
      (m) => m<{ team_id: string | null }[]>`
        select team_id from account_entities where account_id = ${lead.account.id} and entity_id = 2`,
    );
    expect(row?.team_id).toBe(team2);
  });
});

describe('one owner contact per customer (AUDIT M20)', () => {
  it('refuses a second owner, and lists a lead whose owner has no main phone yet', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [3]);
    const lead = await asPrincipal(cc, (context) =>
      runCommand(createLead, { context, audit }, newCustomer(3)),
    );
    const spouse = newId();
    await expect(
      asMigrator(async (m) => {
        await m`insert into contacts (id, name, created_by) values (${spouse}, 'Second owner', ${cc.id})`;
        await m`insert into account_contacts (account_id, contact_id, role, created_by)
                values (${lead.account.id}, ${spouse}, 'owner', ${cc.id})`;
      }),
    ).rejects.toMatchObject({ constraint_name: 'account_contacts_one_owner' });
    await asMigrator(
      (m) => m`insert into account_contacts (account_id, contact_id, role, created_by)
               values (${lead.account.id}, ${spouse}, 'family', ${cc.id})`,
    );

    await asMigrator(
      (m) =>
        m`update contact_phones set is_primary = false where contact_id = ${lead.contact?.id ?? ''}`,
    );
    const listed = (await asPrincipal(cc, (ctx) => listLeads(ctx))).items.filter(
      (l) => l.id === lead.id,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.contact).toMatchObject({ id: lead.contact?.id, phone: null });
  });
});

describe('inviting someone again (AUDIT M26)', () => {
  it('answers the same invited user, so a fresh link can be sent; an active user is refused', async () => {
    const exec = await createTestPrincipal('executive');
    const invite = {
      email: `reinvite-${newId().slice(-12)}@shakti.test`,
      displayName: 'Re-invited',
      entityRoles: [{ entityId: 1, roleKey: 'accounts' as const }],
    };
    const first = await asPrincipal(exec, (context) =>
      runCommand(inviteUser, { context, audit }, invite),
    );
    const second = await asPrincipal(exec, (context) =>
      runCommand(inviteUser, { context, audit }, invite),
    );
    expect(second.id).toBe(first.id);

    await asMigrator((m) => m`update users set status = 'active' where id = ${first.id}`);
    await expect(
      asPrincipal(exec, (context) => runCommand(inviteUser, { context, audit }, invite)),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'invite_email_taken' } });

    const active = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    expect(active.id).not.toBe(first.id);
  });
});
