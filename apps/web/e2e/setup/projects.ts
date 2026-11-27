// J1's project journey fixtures (`e2e/projects.spec.ts`), written by the seed on the host as the
// table owner, afresh each run: the journeys' customer of company 1 with a site, and per journey
// project two confirmed orders, each with its project of the five standard steps, all open, run by
// the Project Manager; the Field Engineer is on the second. Fixed ids, so a run replaces the last.
// Every name here is a test value for these journeys alone.
import { asMigrator, tierId } from '@shakti/db/testing';
import { PROJECT_JOURNEY, PROJECTS } from '../support/users';

const P = '01990000-0000-7000-8000-0000e2e0';
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const ACCOUNT = id(0x0001);
const SITE = id(0x0002);
const LINK = id(0x0003);
const STEPS = ['survey', 'dispatch', 'install', 'commission', 'handover'];

/** Makes the project fixtures again. */
export async function ensureProjectJourneys(people: {
  executive: string;
  projectManager: string;
  fieldEngineer: string;
}): Promise<void> {
  const e = PROJECT_JOURNEY.entityId;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const like = `${P}%`;
      await tx`delete from project_assignments where project_id::text like ${like}`;
      await tx`delete from project_milestones where project_id::text like ${like}`;
      await tx`delete from projects where id::text like ${like}`;
      await tx`delete from sales_orders where id::text like ${like}`;
      await tx`insert into accounts (id, type, name, created_by)
        values (${ACCOUNT}, 'farm', ${PROJECT_JOURNEY.customer}, ${people.executive})
        on conflict (id) do nothing`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
        values (${LINK}, ${ACCOUNT}, ${e}, ${people.executive}, ${people.executive})
        on conflict (id) do nothing`;
      await tx`insert into customer_sites (id, account_id, type, village, district, created_by)
        values (${SITE}, ${ACCOUNT}, 'borewell', ${PROJECT_JOURNEY.village}, 'Jaipur', ${people.executive})
        on conflict (id) do nothing`;
      for (const [i, project] of PROJECTS.entries()) {
        const pairs = [
          {
            no: PROJECT_JOURNEY.managed[project],
            projectId: PROJECT_JOURNEY.ids.managed[project],
            n: 0x0100 + i,
            engineer: false,
          },
          {
            no: PROJECT_JOURNEY.engineered[project],
            projectId: PROJECT_JOURNEY.ids.engineered[project],
            n: 0x0200 + i,
            engineer: true,
          },
        ];
        for (const pair of pairs) {
          const order = id(pair.n);
          const projectId = pair.projectId;
          await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, site_id,
                     tier_id, place_of_supply_state, supply_kind, state, subtotal, cgst, sgst, igst,
                     tax_total, round_off, grand_total, confirmed_at, confirmed_by, created_by)
            values (${order}, ${e}, ${pair.no.replace('/PRJ/', '/SO/')}, '2098-99', ${ACCOUNT}, 'farm',
                    ${SITE}, ${tierId('retail')}, '08', 'intra', 'confirmed', 0, 0, 0, 0, 0, 0, 0,
                    now(), ${people.executive}, ${people.executive})`;
          await tx`insert into projects (id, entity_id, project_no, fy, sales_order_id, account_id, site_id,
                     segment, scheme, flow, owner_id, created_by)
            values (${projectId}, ${e}, ${pair.no}, '2098-99', ${order}, ${ACCOUNT}, ${SITE},
                    'farmer_pumps', 'none', 'standard', ${people.projectManager}, ${people.projectManager})`;
          for (const [position, key] of STEPS.entries()) {
            await tx`insert into project_milestones (id, entity_id, project_id, position, key)
              values (${id(pair.n + 0x0100 + position * 0x0400)}, ${e}, ${projectId}, ${position + 1}, ${key})`;
          }
          if (pair.engineer) {
            await tx`insert into project_assignments (id, entity_id, project_id, person_id, created_by)
              values (${id(pair.n + 0x0020)}, ${e}, ${projectId}, ${people.fieldEngineer}, ${people.projectManager})`;
          }
        }
      }
    }),
  );
}
