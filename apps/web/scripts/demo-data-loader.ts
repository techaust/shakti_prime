// The demo data of the screen review (docs/13-client-packs/wireframe-review.md §1a): a small,
// labelled set and one account per role, put on and taken off through the domain commands only,
// as the first Executive. `demo-data.ts` is the command line; the web suite tests this module.
import {
  type CreateItemInput,
  type ItemCategory,
  type ItemUnit,
  type Principal,
  type StaffRoleKey,
  type UserDto,
  newId,
} from '@shakti/contracts';
import {
  addNote,
  approvePriceList,
  assignOpportunity,
  archiveItem,
  archiveKit,
  cancelTask,
  createItem,
  createKit,
  createLead,
  createPriceList,
  executeCommand,
  executeQuery,
  istCalendarDate,
  inviteUser,
  listCustomers,
  listItems,
  listKitPrices,
  listKits,
  listPipelines,
  listPriceLists,
  listPrices,
  listPriceTierOptions,
  listUsers,
  loadAccount360,
  loseOpportunity,
  moveOpportunityStage,
  reactivateUser,
  recordConsent,
  setAccountTier,
  setPrice,
  suspendUser,
  upsertSite,
  withdrawConsent,
  memoryMailer,
  type AnyCommand,
} from '@shakti/domain';
import { createAuth, type CreateAuthOptions } from '../src/auth/create-auth';
import type { AuthDeps } from '../src/auth/deps';

/** The request context a domain query reads in. */
type QueryContext = Parameters<Parameters<typeof executeQuery>[2]>[0];

/** The mark every record of the set carries where a person sees it. */
export const DEMO_MARK = '(demo)';
/** Every item and kit code of the set starts with this. */
export const DEMO_CODE = 'DEMO-';

type Tier = 'retail' | 'dealer' | 'commercial';
type Prices = Record<Tier, string>;

interface DemoItem {
  key: string;
  code: string;
  name: string;
  category: ItemCategory;
  hsn: string;
  unit: ItemUnit;
  specs: Record<string, number | string>;
  prices: Prices;
}

interface DemoKit {
  code: string;
  name: string;
  components: { item: string; qty: string }[];
  prices: Prices;
}

interface DemoLead {
  entityId: number;
  pipelineKey: string;
  site?: { type: 'borewell' | 'rooftop' | 'factory'; village: string; pin: string };
  /** The stage the lead is moved on to from its first one. */
  stageKey?: string;
  /** The demo person `load --assign` gives the lead to, for the tasks of that role. */
  ownerRole?: StaffRoleKey;
}

interface DemoCustomer {
  name: string;
  contact: string;
  phone: string;
  type: 'household' | 'farm' | 'business' | 'dealer';
  tier?: Tier;
  leads: DemoLead[];
  siteDetails?: { tehsil: string; district: string; address: string; stateCode: string };
  note?: string;
  consent?: boolean;
}

interface DemoPerson {
  roleKey: StaffRoleKey;
  name: string;
  entityIds: number[];
}

export interface DemoSet {
  items: DemoItem[];
  kits: DemoKit[];
  customers: DemoCustomer[];
  people: DemoPerson[];
  /** Every code starts with this (`DEMO-`, and a run's own mark in the tests). */
  codePrefix: string;
}

/** The phones of the five customers; the second ends 4471 for task C5. */
const PHONES = ['9001020011', '9001024471', '9001020013', '9001020014', '9001020015'];

/**
 * The set. `tag` and `phone` serve the tests alone, which load the set again on a shared database
 * on every run: a tag keeps each run's codes and names its own. The command line uses neither.
 * Every amount and name is invented and plainly marked as demo data; no figure is a client's.
 */
export function demoSet(
  options: { tag?: string; phone?: (index: number) => string } = {},
): DemoSet {
  const tag = options.tag === undefined ? '' : `${options.tag}-`;
  const named = (name: string) =>
    options.tag === undefined ? `${name} ${DEMO_MARK}` : `${name} ${options.tag} ${DEMO_MARK}`;
  const phone = options.phone ?? ((index: number) => PHONES[index] ?? '');
  const code = (rest: string) => `${DEMO_CODE}${tag}${rest}`;
  const pump = (hp: number, kw: number, outletMm: number, maxHeadM: number) => ({
    hp,
    kw,
    phase: 'three',
    pumpType: 'submersible',
    outletMm,
    maxHeadM,
  });
  const controller = (kw: number) => ({ kw, inputMinV: 200, inputMaxV: 750 });
  return {
    codePrefix: `${DEMO_CODE}${tag}`,
    items: [
      {
        key: 'pump3',
        code: code('PUMP-3HP'),
        name: named('Submersible pump 3 HP'),
        category: 'pump',
        hsn: '84137010',
        unit: 'nos',
        specs: pump(3, 2.2, 50, 70),
        prices: { retail: '31000.00', dealer: '27500.00', commercial: '29000.00' },
      },
      {
        key: 'pump5',
        code: code('PUMP-5HP'),
        name: named('Submersible pump 5 HP'),
        category: 'pump',
        hsn: '84137010',
        unit: 'nos',
        specs: pump(5, 3.7, 65, 90),
        prices: { retail: '42000.00', dealer: '37500.00', commercial: '39500.00' },
      },
      {
        key: 'pump7',
        code: code('PUMP-7.5HP'),
        name: named('Submersible pump 7.5 HP'),
        category: 'pump',
        hsn: '84137010',
        unit: 'nos',
        specs: pump(7.5, 5.5, 65, 110),
        prices: { retail: '56000.00', dealer: '50000.00', commercial: '53000.00' },
      },
      {
        key: 'ctrl3',
        code: code('CTRL-3HP'),
        name: named('Pump controller 3 HP'),
        category: 'controller',
        hsn: '85044090',
        unit: 'nos',
        specs: controller(2.2),
        prices: { retail: '24000.00', dealer: '21000.00', commercial: '22500.00' },
      },
      {
        key: 'ctrl5',
        code: code('CTRL-5HP'),
        name: named('Pump controller 5 HP'),
        category: 'controller',
        hsn: '85044090',
        unit: 'nos',
        specs: controller(3.7),
        prices: { retail: '32000.00', dealer: '28000.00', commercial: '30000.00' },
      },
      {
        key: 'ctrl7',
        code: code('CTRL-7.5HP'),
        name: named('Pump controller 7.5 HP'),
        category: 'controller',
        hsn: '85044090',
        unit: 'nos',
        specs: controller(5.5),
        prices: { retail: '41000.00', dealer: '36000.00', commercial: '38500.00' },
      },
      {
        key: 'module',
        code: code('MOD-540'),
        name: named('Solar module 540 Wp'),
        category: 'solar_module',
        hsn: '8541',
        unit: 'nos',
        specs: { wp: 540 },
        prices: { retail: '13500.00', dealer: '12000.00', commercial: '12800.00' },
      },
      {
        key: 'structure',
        code: code('STR-PUMP'),
        name: named('Module mounting structure'),
        category: 'structure',
        hsn: '7308',
        unit: 'set',
        specs: {},
        prices: { retail: '18000.00', dealer: '16000.00', commercial: '17000.00' },
      },
      {
        key: 'cable',
        code: code('CBL-4'),
        name: named('Solar cable 4 sq mm'),
        category: 'cable',
        hsn: '8544',
        unit: 'metre',
        specs: {},
        prices: { retail: '90.00', dealer: '78.00', commercial: '84.00' },
      },
    ],
    kits: [
      {
        code: code('KIT-3HP'),
        name: named('3 HP solar pump kit'),
        components: [
          { item: 'pump3', qty: '1' },
          { item: 'ctrl3', qty: '1' },
          { item: 'module', qty: '6' },
          { item: 'structure', qty: '1' },
          { item: 'cable', qty: '30' },
        ],
        prices: { retail: '210000.00', dealer: '188000.00', commercial: '198000.00' },
      },
      {
        code: code('KIT-5HP'),
        name: named('5 HP solar pump kit'),
        components: [
          { item: 'pump5', qty: '1' },
          { item: 'ctrl5', qty: '1' },
          { item: 'module', qty: '9' },
          { item: 'structure', qty: '1' },
          { item: 'cable', qty: '40' },
        ],
        prices: { retail: '285000.00', dealer: '255000.00', commercial: '268000.00' },
      },
      {
        code: code('KIT-7.5HP'),
        name: named('7.5 HP solar pump kit'),
        components: [
          { item: 'pump7', qty: '1' },
          { item: 'ctrl7', qty: '1' },
          { item: 'module', qty: '14' },
          { item: 'structure', qty: '1' },
          { item: 'cable', qty: '50' },
        ],
        prices: { retail: '395000.00', dealer: '352000.00', commercial: '372000.00' },
      },
    ],
    customers: [
      {
        name: named('Bhanwar Lal Jat'),
        contact: named('Bhanwar Lal Jat'),
        phone: phone(0),
        type: 'farm',
        tier: 'retail',
        leads: [
          {
            entityId: 1,
            pipelineKey: 'farmer_pumps',
            site: { type: 'borewell', village: 'Govindgarh', pin: '303712' },
            stageKey: 'qualified',
            ownerRole: 'tele_caller_lc',
          },
          { entityId: 3, pipelineKey: 'residential_rooftop' },
        ],
        siteDetails: {
          tehsil: 'Chomu',
          district: 'Jaipur',
          address: `Borewell beside the village water tank ${DEMO_MARK}`,
          stateCode: '08',
        },
        note: `Wants the 5 HP solar pump kit before the monsoon; call again after he speaks to his son. ${DEMO_MARK}`,
        consent: true,
      },
      {
        name: named('Ramesh Kumar Saini'),
        contact: named('Ramesh Kumar Saini'),
        phone: phone(1),
        type: 'farm',
        tier: 'retail',
        leads: [
          {
            entityId: 1,
            pipelineKey: 'farmer_pumps',
            site: { type: 'borewell', village: 'Chomu', pin: '303702' },
            stageKey: 'contacted',
            ownerRole: 'tele_caller_cc',
          },
        ],
      },
      {
        name: named('Kamla Devi Meena'),
        contact: named('Kamla Devi Meena'),
        phone: phone(2),
        type: 'household',
        tier: 'retail',
        leads: [
          {
            entityId: 3,
            pipelineKey: 'residential_rooftop',
            site: { type: 'rooftop', village: 'Sanganer', pin: '302029' },
          },
        ],
      },
      {
        name: named('Agarwal Cold Storage'),
        contact: named('Suresh Agarwal'),
        phone: phone(3),
        type: 'business',
        tier: 'commercial',
        leads: [
          {
            entityId: 1,
            pipelineKey: 'commercial_epc',
            site: { type: 'factory', village: 'Bagru', pin: '303007' },
            ownerRole: 'tele_caller_cc',
          },
        ],
      },
      {
        name: named('Marwar Pump Traders'),
        contact: named('Mohan Lal Bishnoi'),
        phone: phone(4),
        type: 'dealer',
        tier: 'dealer',
        leads: [{ entityId: 2, pipelineKey: 'dealer_wholesale' }],
      },
    ],
    people: [
      { roleKey: 'executive', name: named('Executive reviewer'), entityIds: [1, 2, 3, 4] },
      {
        roleKey: 'general_manager',
        name: named('General Manager reviewer'),
        entityIds: [1, 2, 3, 4],
      },
      { roleKey: 'sales_team_lead', name: named('Sales Team Lead reviewer'), entityIds: [1] },
      { roleKey: 'tele_caller_cc', name: named('Cold calling reviewer'), entityIds: [1] },
      { roleKey: 'tele_caller_lc', name: named('Lead converter reviewer'), entityIds: [1] },
      { roleKey: 'store_manager', name: named('Store Manager reviewer'), entityIds: [1] },
      {
        roleKey: 'inventory_manager',
        name: named('Inventory Manager reviewer'),
        entityIds: [1, 2, 3, 4],
      },
      { roleKey: 'project_manager', name: named('Project Manager reviewer'), entityIds: [1, 3] },
      { roleKey: 'field_engineer', name: named('Field Engineer reviewer'), entityIds: [1] },
      { roleKey: 'accounts', name: named('Accounts reviewer'), entityIds: [1] },
      { roleKey: 'hr_admin', name: named('HR Admin reviewer'), entityIds: [1] },
    ],
  };
}

/** A demo person's address: `demo.<role>@<domain>`. */
export function demoEmail(roleKey: StaffRoleKey, domain: string): string {
  const role = roleKey.replaceAll('_', '-');
  return `demo.${role}@${domain}`;
}

/**
 * The set-password links of the demo people, made by the auth module through the same flow as
 * Admin › Team members (`requestPasswordReset`, which also withdraws a person's earlier link). The
 * message is caught here instead of mailed, so the script prints the link beside the role; no
 * password is ever made up or shown.
 */
export function setPasswordLinks(
  deps: AuthDeps,
  options: CreateAuthOptions = {},
): (email: string) => Promise<string> {
  const mailer = memoryMailer();
  const auth = createAuth({ ...deps, mailer }, { ...options, nextCookies: false });
  return async (email) => {
    const before = mailer.sent.length;
    // No headers: an internal call, so the bot check does not apply (see create-auth.ts).
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/set-password' } });
    const link = mailer.sent
      .slice(before)
      .find((m) => m.to === email)
      ?.text.match(/https?:\/\/\S+/)?.[0];
    if (link === undefined) throw new Error(`no set-password link was made for ${email}`);
    return link;
  };
}

export interface DemoDeps {
  /** The first Executive, as their sign-in resolves them. */
  operator: Principal;
  set: DemoSet;
  emailDomain: string;
  /** Asks the auth module for a set-password link, as Admin › Team members does, and answers it. */
  issueLink: (email: string) => Promise<string>;
  /** Drops a person's cached access after their status changed. */
  forget: (userId: string) => Promise<void>;
  log: (line: string) => void;
  /**
   * Gives every person still invited a fresh link (which withdraws the earlier one), for links lost
   * before the session. Off by default, so a second load changes nothing.
   */
  newLinks?: boolean;
  /**
   * Gives the demo leads to the demo callers (`crm.opportunity.assign`), for the people who have
   * set their password; an invited person cannot be given a lead. Run once they have signed in.
   */
  assign?: boolean;
}

export interface DemoAccount {
  roleKey: StaffRoleKey;
  email: string;
  /** Set when this run sent the person a link; an account already invited keeps its own. */
  link?: string;
}

export interface DemoSummary {
  /** Commands run; a second `load` runs none. */
  writes: number;
  accounts: DemoAccount[];
  /** Addresses of the set held by someone who is not a demo account: left alone. */
  notDemo: string[];
  /** Demo accounts found under another email domain than the one given. */
  elsewhere: string[];
  /** Demo people who must set their password before `load --assign` can give them leads. */
  waiting: string[];
}

/**
 * The demo account of a person of the set: the address and the demo name both, so someone who is
 * not a demo account but happens to hold the address is never suspended or sent a link.
 */
function demoAccountOf(people: readonly UserDto[], person: DemoPerson, email: string) {
  const atAddress = people.find((u) => u.email === email);
  if (atAddress === undefined) return { kind: 'missing' as const };
  return atAddress.displayName === person.name
    ? { kind: 'demo' as const, user: atAddress }
    : { kind: 'not_demo' as const };
}

/** Demo-named accounts of the set whose address is not under `domain`. */
function demoAccountsElsewhere(people: readonly UserDto[], set: DemoSet, domain: string): string[] {
  const names = new Set(set.people.map((p) => p.name));
  return people
    .filter((u) => names.has(u.displayName) && !u.email.endsWith(`@${domain}`))
    .map((u) => u.email);
}

/** The demo set was removed here: archived records cannot come back through any command. */
export class DemoAlreadyRemoved extends Error {
  override name = 'DemoAlreadyRemoved';
}

const ALL_COMPANIES = undefined;

/**
 * What the audit rows record as the device of every change the loader makes, so the Activity log
 * tells the script's writes from the Executive's own.
 */
export const DEMO_CLIENT = { ip: null, device: 'scripts/demo-data.ts' } as const;

function runner(deps: DemoDeps) {
  let writes = 0;
  const scope = (entityIds?: readonly number[]) =>
    entityIds === ALL_COMPANIES ? { requestId: newId() } : { requestId: newId(), entityIds };
  return {
    get writes() {
      return writes;
    },
    async run(
      command: AnyCommand,
      input: unknown,
      entityIds?: readonly number[],
    ): Promise<unknown> {
      writes += 1;
      return executeCommand(deps.operator, scope(entityIds), command, input, {
        client: DEMO_CLIENT,
      });
    },
    read<T>(
      name: string,
      query: (context: QueryContext) => Promise<T>,
      entityIds?: readonly number[],
    ): Promise<T> {
      return executeQuery(deps.operator, scope(entityIds), query, { name });
    },
  };
}
type Runner = ReturnType<typeof runner>;

/** The set's own items, by their codes, archived ones included. */
async function demoItems(r: Runner, set: DemoSet) {
  const codes = new Set(set.items.map((i) => i.code));
  const found = [];
  let cursor: string | undefined;
  do {
    const page = await r.read('demoData.items', (ctx) =>
      listItems(ctx, { q: set.codePrefix, includeArchived: true, limit: 200, cursor }),
    );
    found.push(...page.items.filter((i) => codes.has(i.sku)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return found;
}

/** The set's own kits, by their codes, archived ones included. */
async function demoKits(r: Runner, set: DemoSet) {
  const codes = new Set(set.kits.map((k) => k.code));
  const found = [];
  let cursor: string | undefined;
  do {
    const page = await r.read('demoData.kits', (ctx) =>
      listKits(ctx, { q: set.codePrefix, includeArchived: true, limit: 200, cursor }),
    );
    found.push(...page.items.filter((k) => codes.has(k.sku)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return found;
}

/** Every staff member, for the demo people among them. */
async function everyone(r: Runner): Promise<UserDto[]> {
  const found: UserDto[] = [];
  let cursor: string | undefined;
  do {
    const page = await r.read('demoData.users', (ctx) =>
      listUsers(ctx, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    );
    found.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return found;
}

/** A customer's relationships with the companies, found by its exact name. */
async function customerRows(r: Runner, name: string) {
  const page = await r.read('demoData.customers', (ctx) =>
    listCustomers(ctx, { q: name, limit: 200 }),
  );
  return page.items.filter((row) => row.name === name);
}

/** The live price list shared by every company for each tier, made and approved when missing. */
async function tierLists(
  r: Runner,
  today: string,
  log: (line: string) => void,
): Promise<Record<Tier, string>> {
  const lists = await r.read('demoData.priceLists', (ctx) => listPriceLists(ctx));
  const found: Partial<Record<Tier, string>> = {};
  for (const tier of ['retail', 'dealer', 'commercial'] as const) {
    const live = lists.find(
      (l) => l.tierCode === tier && l.entityId === null && l.state === 'live',
    );
    if (live) {
      found[tier] = live.id;
      continue;
    }
    // A shared draft from today is one an earlier run stopped before approving: it is reused,
    // rather than a second list made beside it.
    const left = lists.find(
      (l) =>
        l.tierCode === tier &&
        l.entityId === null &&
        l.state === 'draft' &&
        l.effectiveFrom === today,
    );
    const draft =
      left ??
      ((await r.run(createPriceList, { tierCode: tier, effectiveFrom: today })) as { id: string });
    await r.run(approvePriceList, { priceListId: draft.id });
    log(
      `made the shared ${tier} price list ${draft.id}, live from ${today}; it stays after remove`,
    );
    found[tier] = draft.id;
  }
  return found as Record<Tier, string>;
}

/** What one list holds now for the set's items and kits, by id. */
async function listedPrices(r: Runner, priceListId: string): Promise<Map<string, string | null>> {
  const held = new Map<string, string | null>();
  let cursor: string | undefined;
  do {
    const page = await r.read('demoData.prices', (ctx) =>
      listPrices(ctx, { priceListId, limit: 200, cursor }),
    );
    for (const row of page.items) held.set(row.itemId, row.price);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  cursor = undefined;
  do {
    const page = await r.read('demoData.kitPrices', (ctx) =>
      listKitPrices(ctx, { priceListId, limit: 200, cursor }),
    );
    for (const row of page.items) held.set(row.kitId, row.price);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return held;
}

/**
 * Loads the set: what is already there is left as it is, so a second run writes nothing. Refuses a
 * database the set was removed from, since an archived item or kit cannot come back.
 */
export async function loadDemoData(deps: DemoDeps): Promise<DemoSummary> {
  const r = runner(deps);
  const { set } = deps;
  const today = istCalendarDate(new Date());

  // The catalogue: items, then kits of them.
  const items = await demoItems(r, set);
  const kits = await demoKits(r, set);
  if (items.some((i) => !i.isActive) || kits.some((k) => !k.isActive)) {
    throw new DemoAlreadyRemoved(
      'The demo data was removed from this database; its items cannot be loaded again.',
    );
  }
  const itemIds = new Map<string, string>();
  for (const item of set.items) {
    const existing = items.find((i) => i.sku === item.code);
    if (existing) {
      itemIds.set(item.key, existing.id);
      continue;
    }
    const input: CreateItemInput = {
      sku: item.code,
      name: item.name,
      category: item.category,
      hsn: item.hsn,
      unit: item.unit,
      specs: item.specs,
    };
    const made = (await r.run(createItem, input)) as { id: string };
    itemIds.set(item.key, made.id);
    deps.log(`item ${item.code}`);
  }
  const kitIds = new Map<string, string>();
  for (const kit of set.kits) {
    const existing = kits.find((k) => k.sku === kit.code);
    if (existing) {
      kitIds.set(kit.code, existing.id);
      continue;
    }
    const made = (await r.run(createKit, {
      sku: kit.code,
      name: kit.name,
      components: kit.components.map((c) => ({ itemId: itemIds.get(c.item), qty: c.qty })),
    })) as { id: string };
    kitIds.set(kit.code, made.id);
    deps.log(`kit ${kit.code}`);
  }

  // Their prices on the Retail, Dealer and Commercial lists.
  const lists = await tierLists(r, today, deps.log);
  for (const tier of ['retail', 'dealer', 'commercial'] as const) {
    const priceListId = lists[tier];
    const held = await listedPrices(r, priceListId);
    const wanted: { itemId?: string; kitId?: string; id: string; price: string }[] = [
      ...set.items.map((i) => {
        const id = itemIds.get(i.key) ?? '';
        return { itemId: id, id, price: i.prices[tier] };
      }),
      ...set.kits.map((k) => {
        const id = kitIds.get(k.code) ?? '';
        return { kitId: id, id, price: k.prices[tier] };
      }),
    ];
    let changed = 0;
    for (const { id, price, ...target } of wanted) {
      if (held.get(id) === price) continue;
      await r.run(setPrice, { priceListId, ...target, price, reason: `Demo price ${DEMO_MARK}` });
      changed += 1;
    }
    if (changed > 0) deps.log(`${String(changed)} prices on the ${tier} list`);
  }

  // Customers, their leads, the site, the note, the consent and the price tier.
  const pipelines = await r.read('demoData.pipelines', (ctx) => listPipelines(ctx));
  const tiers = await r.read('demoData.tiers', (ctx) => listPriceTierOptions(ctx));
  for (const customer of set.customers) {
    let rows = await customerRows(r, customer.name);
    for (const lead of customer.leads) {
      const accountId = rows[0]?.accountId;
      const inCompany = rows.some((row) => row.entityId === lead.entityId);
      const leads = inCompany
        ? (
            await r.read(
              'demoData.account360',
              (ctx) => loadAccount360(ctx, { accountId, entityId: lead.entityId }),
              [lead.entityId],
            )
          ).leads
        : [];
      if (leads.length === 0) {
        await r.run(
          createLead,
          accountId === undefined
            ? {
                entityId: lead.entityId,
                pipelineKey: lead.pipelineKey,
                contact: { name: customer.contact, phone: customer.phone },
                account: { type: customer.type, name: customer.name },
                ...(lead.site ? { site: lead.site } : {}),
              }
            : {
                entityId: lead.entityId,
                pipelineKey: lead.pipelineKey,
                existingAccountId: accountId,
              },
          [lead.entityId],
        );
        deps.log(`lead of ${customer.name} in company ${String(lead.entityId)}`);
        rows = await customerRows(r, customer.name);
      }
      if (lead.stageKey !== undefined) {
        const account = rows[0]?.accountId;
        const view = await r.read(
          'demoData.account360',
          (ctx) => loadAccount360(ctx, { accountId: account, entityId: lead.entityId }),
          [lead.entityId],
        );
        const pipeline = pipelines.find(
          (p) =>
            p.key === lead.pipelineKey && (p.entityId === null || p.entityId === lead.entityId),
        );
        const first = pipeline?.stages[0];
        const target = pipeline?.stages.find((s) => s.key === lead.stageKey);
        const open = view.leads.find((l) => l.state === 'open' && l.stageName === first?.name);
        if (open && target) {
          await r.run(
            moveOpportunityStage,
            { entityId: lead.entityId, opportunityId: open.id, stageId: target.id },
            [lead.entityId],
          );
        }
      }
    }

    const accountId = rows[0]?.accountId;
    const home = customer.leads[0]?.entityId ?? 1;
    const view = await r.read(
      'demoData.account360',
      (ctx) => loadAccount360(ctx, { accountId, entityId: home }),
      [home],
    );
    const details = customer.siteDetails;
    const site = view.sites[0];
    if (details && site && (site.tehsil !== details.tehsil || site.address !== details.address)) {
      await r.run(
        upsertSite,
        {
          entityId: home,
          accountId,
          siteId: site.id,
          type: site.type,
          village: site.village,
          pin: site.pin,
          tehsil: details.tehsil,
          district: details.district,
          address: details.address,
          stateCode: details.stateCode,
        },
        [home],
      );
    }
    if (customer.note !== undefined && !view.timeline.items.some((a) => a.body === customer.note)) {
      await r.run(addNote, { entityId: home, accountId, body: customer.note }, [home]);
    }
    const contactId = view.contacts[0]?.id;
    if (customer.consent === true && contactId !== undefined && view.consents.length === 0) {
      await r.run(
        recordConsent,
        {
          entityId: home,
          accountId,
          contactId,
          channel: 'call',
          purpose: 'service',
          source: 'verbal',
          textVersion: 'demo-v1',
          givenAt: new Date().toISOString(),
        },
        [home],
      );
    }
    const tierId = tiers.find((t) => t.code === customer.tier)?.id;
    if (tierId !== undefined && view.account.tierId !== tierId) {
      await r.run(setAccountTier, { entityId: home, accountId, tierId }, [home]);
    }
  }

  // One account per role, invited as Admin › Team members invites.
  const people = await everyone(r);
  const accounts: DemoAccount[] = [];
  const notDemo: string[] = [];
  for (const person of set.people) {
    const email = demoEmail(person.roleKey, deps.emailDomain);
    const match = demoAccountOf(people, person, email);
    if (match.kind === 'not_demo') {
      notDemo.push(email);
      continue;
    }
    const found = match.kind === 'demo' ? match.user : undefined;
    if (found && found.status !== 'suspended') {
      accounts.push(
        found.status === 'invited' && deps.newLinks === true
          ? { roleKey: person.roleKey, email, link: await deps.issueLink(email) }
          : { roleKey: person.roleKey, email },
      );
      continue;
    }
    if (found) {
      await r.run(reactivateUser, { userId: found.id });
      await deps.forget(found.id);
    } else {
      await r.run(inviteUser, {
        email,
        displayName: person.name,
        entityRoles: person.entityIds.map((entityId) => ({ entityId, roleKey: person.roleKey })),
      });
    }
    accounts.push({ roleKey: person.roleKey, email, link: await deps.issueLink(email) });
  }

  const waiting = deps.assign === true ? await assignLeads(r, deps) : [];
  return {
    writes: r.writes,
    accounts,
    notDemo,
    elsewhere: demoAccountsElsewhere(people, set, deps.emailDomain),
    waiting,
  };
}

/**
 * `load --assign`: each demo lead with an `ownerRole` goes to that demo person through
 * `crm.opportunity.assign`, which moves the customer and the open calls with it, so the callers'
 * queues and boards hold the leads their tasks name. Only when the owner differs, so a second run
 * changes nothing. Answers the addresses of the people still to set their password, whose leads
 * wait. No command makes a team, so the callers are not put in one with the Team Lead.
 */
async function assignLeads(r: Runner, deps: DemoDeps): Promise<string[]> {
  const people = await everyone(r);
  const waiting = new Set<string>();
  for (const customer of deps.set.customers) {
    for (const lead of customer.leads) {
      if (lead.ownerRole === undefined) continue;
      const person = deps.set.people.find((p) => p.roleKey === lead.ownerRole);
      if (person === undefined) continue;
      const email = demoEmail(person.roleKey, deps.emailDomain);
      const match = demoAccountOf(people, person, email);
      if (match.kind !== 'demo' || match.user.status !== 'active') {
        waiting.add(email);
        continue;
      }
      const owner = match.user;
      const row = (await customerRows(r, customer.name)).find((c) => c.entityId === lead.entityId);
      if (row === undefined) continue;
      const view = await r.read(
        'demoData.account360',
        (ctx) => loadAccount360(ctx, { accountId: row.accountId, entityId: lead.entityId }),
        [lead.entityId],
      );
      for (const open of view.leads) {
        if (open.state !== 'open' || open.ownerId === owner.id) continue;
        await r.run(
          assignOpportunity,
          { entityId: lead.entityId, opportunityId: open.id, ownerId: owner.id },
          [lead.entityId],
        );
        deps.log(`gave the lead of ${customer.name} to ${email}`);
      }
    }
  }
  return [...waiting];
}

/**
 * Takes the set off through the commands: every open demo lead is closed as lost, every task on
 * them cancelled, every consent withdrawn, every kit and item archived, and every demo account
 * suspended, which signs it out. What the domain keeps (customers, the timeline, the price change
 * log, the audit trail) stays, as the architecture requires. It changes nothing when no demo
 * account is at the given domain, since that is most likely the wrong `--email-domain`.
 */
export async function removeDemoData(deps: DemoDeps): Promise<DemoSummary> {
  const r = runner(deps);
  const { set } = deps;

  const people = await everyone(r);
  const notDemo: string[] = [];
  const found: { person: DemoPerson; email: string; user: UserDto }[] = [];
  for (const person of set.people) {
    const email = demoEmail(person.roleKey, deps.emailDomain);
    const match = demoAccountOf(people, person, email);
    if (match.kind === 'not_demo') notDemo.push(email);
    if (match.kind === 'demo') found.push({ person, email, user: match.user });
  }
  const elsewhere = demoAccountsElsewhere(people, set, deps.emailDomain);
  if (found.length === 0) return { writes: 0, accounts: [], notDemo, elsewhere, waiting: [] };

  for (const customer of set.customers) {
    const rows = await customerRows(r, customer.name);
    const before = r.writes;
    let consentsDone = false;
    for (const row of rows) {
      const view = await r.read(
        'demoData.account360',
        (ctx) => loadAccount360(ctx, { accountId: row.accountId, entityId: row.entityId }),
        [row.entityId],
      );
      for (const lead of view.leads) {
        if (lead.state !== 'open' && lead.state !== 'nurture') continue;
        await r.run(
          loseOpportunity,
          { entityId: row.entityId, opportunityId: lead.id, reasonCode: 'not_interested' },
          [row.entityId],
        );
      }
      const after = await r.read(
        'demoData.account360',
        (ctx) => loadAccount360(ctx, { accountId: row.accountId, entityId: row.entityId }),
        [row.entityId],
      );
      for (const task of after.tasks) {
        if (task.state !== 'open') continue;
        await r.run(cancelTask, { entityId: row.entityId, taskId: task.id }, [row.entityId]);
      }
      if (!consentsDone) {
        for (const consent of after.consents) {
          if (consent.withdrawnAt !== null) continue;
          await r.run(
            withdrawConsent,
            { entityId: row.entityId, accountId: row.accountId, consentId: consent.id },
            [row.entityId],
          );
        }
        consentsDone = true;
      }
    }
    if (r.writes > before) deps.log(`closed the leads of ${customer.name}`);
  }

  for (const kit of await demoKits(r, set)) {
    if (!kit.isActive) continue;
    await r.run(archiveKit, { kitId: kit.id });
    deps.log(`archived kit ${kit.sku}`);
  }
  for (const item of await demoItems(r, set)) {
    if (!item.isActive) continue;
    await r.run(archiveItem, { itemId: item.id });
    deps.log(`archived item ${item.sku}`);
  }

  const accounts: DemoAccount[] = [];
  for (const { person, email, user } of found) {
    if (user.status === 'invited' || user.status === 'active') {
      await r.run(suspendUser, { userId: user.id, reason: `Screen review over ${DEMO_MARK}` });
      await deps.forget(user.id);
      deps.log(`closed the account ${email}`);
    }
    accounts.push({ roleKey: person.roleKey, email });
  }
  return { writes: r.writes, accounts, notDemo, elsewhere, waiting: [] };
}
