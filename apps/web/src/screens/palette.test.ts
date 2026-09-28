import type { PaletteSearchDto, PermissionGrant } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../nav';
import { canSearch, visibleActions, visibleNav } from './menu-access';
import { foundCount, leadHref, paletteSections, searchText } from './palette';

const id = (n: number) => `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const TELE_CALLER: PermissionGrant[] = [
  { key: 'crm.lead.read', scope: 'own' },
  { key: 'crm.lead.write', scope: 'own' },
  { key: 'crm.account.write', scope: 'own' },
];
const EXECUTIVE: PermissionGrant[] = [
  ...TELE_CALLER,
  { key: 'imports.write', scope: 'all' },
  { key: 'admin.users.write', scope: 'all' },
];

const FOUND: PaletteSearchDto = {
  leads: [
    {
      id: id(1),
      entityId: 2,
      pipelineKey: 'farmer_pumps',
      state: 'open',
      customerName: 'Ramesh Patil',
      village: 'Ozar',
    },
    {
      id: id(2),
      entityId: 1,
      pipelineKey: 'solar_rooftop',
      state: 'nurture',
      customerName: 'Ramesh Jadhav',
      village: null,
    },
  ],
  people: [{ id: id(3), displayName: 'Ramesh Kale', email: 'ramesh.kale@shakti.test' }],
};

describe('the palette actions', () => {
  it('offer each action only with the grants behind it', () => {
    expect(visibleActions([]).map((a) => a.id)).toEqual([]);
    expect(visibleActions(TELE_CALLER).map((a) => a.id)).toEqual(['new-lead']);
    expect(visibleActions(EXECUTIVE).map((a) => a.id)).toEqual([
      'new-lead',
      'new-import',
      'invite',
    ]);
  });

  it('open the invite dialog on Team members', () => {
    expect(visibleActions(EXECUTIVE).find((a) => a.id === 'invite')?.href).toBe(
      '/admin/users?invite=1',
    );
  });
});

describe('the palette search', () => {
  it('waits for two characters, not counting spaces', () => {
    expect(searchText('')).toBeUndefined();
    expect(searchText(' r ')).toBeUndefined();
    expect(searchText(' ra ')).toBe('ra');
  });

  it('is offered to a caller who can read leads or team members', () => {
    expect(canSearch([])).toBe(false);
    expect(canSearch([{ key: 'pricing.read', scope: 'entity' }])).toBe(false);
    expect(canSearch(TELE_CALLER)).toBe(true);
    expect(canSearch([{ key: 'admin.users.write', scope: 'all' }])).toBe(true);
  });

  it('opens a lead on the board of its company and pipeline, at its status', () => {
    expect(leadHref({ entityId: 2, pipelineKey: 'farmer_pumps', state: 'open' })).toBe(
      '/leads/board?company=2&pipeline=farmer_pumps',
    );
    expect(leadHref({ entityId: 1, pipelineKey: 'solar_rooftop', state: 'nurture' })).toBe(
      '/leads/board?company=1&pipeline=solar_rooftop&show=nurture',
    );
  });

  it('counts the leads and the team members found', () => {
    expect(foundCount(FOUND)).toBe(3);
    expect(foundCount({ leads: [], people: [] })).toBe(0);
  });
});

describe('paletteSections', () => {
  it('holds Go to and Actions before anything is searched, without a page an action opens', () => {
    const sections = paletteSections({
      nav: visibleNav(EXECUTIVE),
      actions: visibleActions(EXECUTIVE),
      found: undefined,
    });
    expect(sections.map((s) => s.id)).toEqual(['goto', 'actions']);
    const goto = sections[0]?.entries.map((e) => e.id) ?? [];
    expect(goto).toContain('leads');
    expect(goto).not.toContain('leads-new');
    expect(sections[1]?.entries.map((e) => e.href)).toEqual([
      '/leads/new',
      '/imports/new',
      '/admin/users?invite=1',
    ]);
  });

  it('keeps every screen in Go to for a caller with no actions', () => {
    const nav = NAV_ITEMS.filter((i) => i.id === 'leads-new' || i.id === 'home');
    const [goto] = paletteSections({ nav, actions: [], found: undefined });
    expect(goto?.entries.map((e) => e.id)).toEqual(['home', 'leads-new']);
  });

  it('puts the leads and then the team members found between Go to and Actions, as found', () => {
    const sections = paletteSections({ nav: [], actions: [], found: FOUND });
    expect(sections.map((s) => s.id)).toEqual(['goto', 'search', 'actions']);
    const search = sections[1];
    expect(search?.prefiltered).toBe(true);
    expect(search?.entries.map((e) => [e.kind, e.id, e.href])).toEqual([
      ['lead', `lead-${id(1)}`, '/leads/board?company=2&pipeline=farmer_pumps'],
      ['lead', `lead-${id(2)}`, '/leads/board?company=1&pipeline=solar_rooftop&show=nurture'],
      ['person', `person-${id(3)}`, '/admin/users'],
    ]);
  });

  it('keeps an empty Search section when nothing matched, for the sentence that says so', () => {
    const sections = paletteSections({ nav: [], actions: [], found: { leads: [], people: [] } });
    expect(sections.find((s) => s.id === 'search')?.entries).toEqual([]);
  });
});
