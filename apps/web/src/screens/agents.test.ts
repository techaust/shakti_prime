import { AGENT_ACTION_TYPES } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import {
  ACTION_TYPE_NAMES,
  actionTypeName,
  agentFieldName,
  agentSummaryName,
  inboxKeyAction,
  moneyFromPaise,
  paiseFromRupees,
  rupeesFromPaise,
} from './agents';
import { AGENT_ROLES, agentNameKey } from './contract-values';

describe('the agents’ names on screen', () => {
  it('names every action type the domain has, and every field a person may change', () => {
    expect(Object.keys(ACTION_TYPE_NAMES).sort()).toEqual(Object.keys(AGENT_ACTION_TYPES).sort());
    for (const [type, def] of Object.entries(AGENT_ACTION_TYPES)) {
      const key = actionTypeName(type);
      expect(key === undefined ? undefined : en.agents.actionTypes[key]).toBeTruthy();
      for (const field of def.editable) {
        const name = agentFieldName(field.name);
        expect(name === undefined ? undefined : en.agents.fields[name]).toBeTruthy();
      }
      for (const field of def.summary) {
        const name = agentSummaryName(field.name);
        expect(name === undefined ? undefined : en.agents.inbox.summary[name]).toBeTruthy();
      }
    }
    expect(actionTypeName('crm.lead.unknown')).toBeUndefined();
    expect(actionTypeName(null)).toBeUndefined();
  });

  it('names every agent', () => {
    for (const agent of AGENT_ROLES) expect(en.agents.names[agentNameKey(agent)]).toBeTruthy();
  });
});

describe('inboxKeyAction', () => {
  const key = (k: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) =>
    inboxKeyAction({ key: k, altKey: false, ctrlKey: false, metaKey: false, ...mods });

  it('moves with J, K and the arrows, decides with A, E and R, and opens or dismisses with O and D', () => {
    expect(['j', 'ArrowDown', 'k', 'ArrowUp', 'a', 'E', 'r', 'o', 'D'].map((k) => key(k))).toEqual([
      'next',
      'next',
      'previous',
      'previous',
      'approve',
      'edit',
      'reject',
      'open',
      'dismiss',
    ]);
  });

  it('leaves other keys and shortcuts with a modifier alone', () => {
    expect(key('x')).toBeUndefined();
    expect(key('a', { ctrlKey: true })).toBeUndefined();
    expect(key('r', { metaKey: true })).toBeUndefined();
  });
});

describe('the spending limit in rupees', () => {
  it('reads rupees with at most two digits after the point as paise', () => {
    expect(paiseFromRupees('500')).toBe(50_000);
    expect(paiseFromRupees(' 1,250.5 ')).toBe(125_050);
    expect(paiseFromRupees('0.05')).toBe(5);
    expect(paiseFromRupees('')).toBeNull();
    expect(paiseFromRupees('12.345')).toBeUndefined();
    expect(paiseFromRupees('-3')).toBeUndefined();
    expect(paiseFromRupees('five')).toBeUndefined();
  });

  it('shows paise as rupees again', () => {
    expect(rupeesFromPaise(50_000)).toBe('500');
    expect(rupeesFromPaise(125_050)).toBe('1250.50');
    expect(rupeesFromPaise(null)).toBe('');
    expect(moneyFromPaise(125_050)).toBe('1250.50');
    expect(moneyFromPaise(7)).toBe('0.07');
  });
});
