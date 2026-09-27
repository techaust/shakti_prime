// First-user bootstrap, run once per environment from the command line (never from the app).
// It writes with the migrator connection because no principal exists yet to run the invite
// command; every later user is invited through admin.user.invite.
import { newId, type Id } from '@shakti/contracts';
import postgres from 'postgres';
import { ALL_ENTITY_IDS } from '../seeds/entities';
import { roleId } from '../seeds/roles';
import { connectionOptions } from './connection';
import { requireEnv } from './env';

export interface BootstrapExecutiveInput {
  email: string;
  name: string;
  /** Allow a second Executive even when one already exists. */
  force?: boolean;
}

/**
 * Creates an `invited` Executive over every entity. Refuses when an invited or active Executive
 * already exists, unless forced. Returns the new user id; the caller mails the set-password link.
 */
export async function bootstrapExecutive(input: BootstrapExecutiveInput): Promise<Id> {
  const url = requireEnv('DATABASE_URL_MIGRATOR');
  const sql = postgres(url, {
    ...connectionOptions(url, 'shakti-bootstrap'),
    max: 1,
    prepare: false,
  });
  const email = input.email.trim().toLowerCase();
  try {
    return await sql.begin(async (tx) => {
      const [existing] = await tx<{ n: number }[]>`
        select count(*)::int as n from users u
        join user_entity_roles uer on uer.user_id = u.id
        where uer.role_id = ${roleId('executive')} and u.status in ('invited', 'active')`;
      if ((existing?.n ?? 0) > 0 && input.force !== true) {
        throw new Error(
          'an Executive already exists; invite further users from the app or pass --force',
        );
      }
      const [taken] = await tx<{ id: string }[]>`select id from users where email = ${email}`;
      if (taken) throw new Error(`a user with email ${email} already exists`);
      const id = newId();
      await tx`insert into principals (id, kind, display_name) values (${id}, 'user', ${input.name})`;
      await tx`insert into users (id, name, email, status) values (${id}, ${input.name}, ${email}, 'invited')`;
      for (const entityId of ALL_ENTITY_IDS) {
        await tx`insert into user_entity_roles (id, user_id, entity_id, role_id)
          values (${newId()}, ${id}, ${entityId}, ${roleId('executive')})`;
      }
      return id;
    });
  } finally {
    await sql.end();
  }
}
