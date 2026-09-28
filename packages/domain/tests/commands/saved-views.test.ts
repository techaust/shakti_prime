import {
  newId,
  SAVED_VIEWS_PER_SCREEN,
  type Principal,
  type SavedViewSettings,
} from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand, executeQuery } from '../../src/command/execute';
import { deleteView, saveView } from '../../src/commands/profile/saved-views';
import { memoryLogger } from '../../src/ports/logger';
import { listSavedViews } from '../../src/queries/profile/saved-views';

afterAll(closeDb);

const logger = memoryLogger();

const settings: SavedViewSettings = {
  columns: { hidden: ['phone', 'company'] },
  sort: { columnId: 'updated', direction: 'desc' },
  filters: {},
  density: 'compact',
};

function save(caller: Principal, input: unknown, requestId = newId(), idempotencyKey?: string) {
  return executeCommand(
    caller,
    { entityIds: caller.entityIds, requestId },
    saveView,
    input,
    idempotencyKey === undefined ? { logger } : { logger, idempotencyKey },
  );
}

function list(caller: Principal, screen: string) {
  return executeQuery(caller, {}, (context) => listSavedViews(context, { screen }));
}

async function auditRows(requestId: string) {
  return asMigrator(
    (m) => m<
      {
        command: string;
        outcome: string;
        entity_id: number | null;
        aggregate_type: string | null;
        before_json: unknown;
        after_json: unknown;
      }[]
    >`select command, outcome, entity_id, aggregate_type, before_json, after_json
        from audit_logs where request_id = ${requestId}`,
  );
}

describe('profile.view.save and profile.view.delete (DESIGN.md §6)', () => {
  it('is denied to an agent principal, which holds no profile.write', async () => {
    const agent = principalFor('agent:triage', [1]);
    await expect(save(agent, { screen: 'leads', name: 'Mine', settings })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses an unknown screen, a blank name and settings the grid does not know', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    for (const input of [
      { screen: 'stock', name: 'Mine', settings },
      { screen: 'leads', name: '   ', settings },
      { screen: 'leads', name: 'Mine', settings: { ...settings, colour: 'red' } },
      { screen: 'leads', name: 'Mine', settings: { ...settings, density: 'tight' } },
    ]) {
      await expect(save(caller, input)).rejects.toMatchObject({ code: 'validation_failed' });
    }
  });

  it('saves a view, lists it for its owner only, renames it and records each change', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const other = await createTestPrincipal('tele_caller_cc', [1]);
    const name = `Hot leads ${newId().slice(-8)}`;
    const created = newId();
    const view = await save(caller, { screen: 'leads', name: `  ${name}  `, settings }, created);
    expect(view).toMatchObject({ screen: 'leads', name, settings });
    expect((await list(caller, 'leads')).map((v) => v.id)).toContain(view.id);
    expect(await list(caller, 'imports')).toEqual([]);
    expect(await list(other, 'leads')).toEqual([]);
    // In any company: a view belongs to the person, not to a company.
    expect((await list({ ...caller, entityIds: [] }, 'leads')).map((v) => v.id)).toContain(view.id);

    const renamed = newId();
    const wider = { ...settings, columns: { hidden: [] }, density: 'comfortable' as const };
    const updated = await save(
      caller,
      { id: view.id, screen: 'leads', name: `${name} renamed`, settings: wider },
      renamed,
    );
    expect(updated).toMatchObject({ id: view.id, name: `${name} renamed`, settings: wider });

    expect(await auditRows(created)).toEqual([
      {
        command: 'profile.view.save',
        outcome: 'ok',
        entity_id: null,
        aggregate_type: 'saved_view',
        before_json: null,
        after_json: { screen: 'leads', name, settings },
      },
    ]);
    expect(await auditRows(renamed)).toMatchObject([
      {
        before_json: { name },
        after_json: { name: `${name} renamed`, settings: wider },
      },
    ]);
  });

  it('answers a name the person already uses on the screen with its own sentence', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const name = `Village ${newId().slice(-8)}`;
    await save(caller, { screen: 'leads', name, settings });
    await expect(save(caller, { screen: 'leads', name, settings })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'saved_view_name_taken' },
    });
    // The same name on another screen is a different view.
    await expect(save(caller, { screen: 'imports', name, settings })).resolves.toMatchObject({
      name,
    });
  });

  it("cannot rename, change or delete another person's view, nor move a view to another screen", async () => {
    const owner = await createTestPrincipal('tele_caller_cc', [1]);
    const other = await createTestPrincipal('executive');
    const view = await save(owner, { screen: 'leads', name: `Owned ${newId()}`, settings });
    const gone = { code: 'not_found', details: { reason: 'saved_view_gone' } };
    await expect(
      save(other, { id: view.id, screen: 'leads', name: 'Taken', settings }),
    ).rejects.toMatchObject(gone);
    await expect(
      save(owner, { id: view.id, screen: 'imports', name: view.name, settings }),
    ).rejects.toMatchObject(gone);
    await expect(
      executeCommand(other, { requestId: newId() }, deleteView, { id: view.id }, { logger }),
    ).rejects.toMatchObject(gone);
    expect((await list(owner, 'leads')).map((v) => v.name)).toContain(view.name);

    const removed = newId();
    await expect(
      executeCommand(owner, { requestId: removed }, deleteView, { id: view.id }, { logger }),
    ).resolves.toEqual({ id: view.id });
    expect((await list(owner, 'leads')).map((v) => v.id)).not.toContain(view.id);
    expect(await auditRows(removed)).toMatchObject([
      { command: 'profile.view.delete', aggregate_type: 'saved_view', after_json: null },
    ]);
  });

  it(`keeps at most ${String(SAVED_VIEWS_PER_SCREEN)} views per person on one screen`, async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const base = newId().slice(-8);
    await asMigrator(async (m) => {
      for (let i = 0; i < SAVED_VIEWS_PER_SCREEN; i++) {
        await m`insert into saved_views (id, principal_id, screen, name, settings_json)
                values (${newId()}, ${caller.id}, 'price_lists', ${`View ${base} ${String(i)}`}, '{}')`;
      }
    });
    await expect(
      save(caller, { screen: 'price_lists', name: `One more ${base}`, settings }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'saved_view_limit' } });
    // Settings stored by an older screen come back as the grid's defaults.
    const [first] = await list(caller, 'price_lists');
    expect(first?.settings).toEqual({
      columns: { hidden: [] },
      sort: null,
      filters: {},
      density: 'compact',
    });
  });

  it('saves once when the same form is sent twice with one key', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const input = { screen: 'team_members', name: `Twice ${newId().slice(-8)}`, settings };
    const key = newId();
    const first = await save(caller, input, newId(), key);
    const repeat = await save(caller, input, newId(), key);
    expect(repeat).toEqual(first);
    expect((await list(caller, 'team_members')).filter((v) => v.name === input.name)).toHaveLength(
      1,
    );
  });
});
