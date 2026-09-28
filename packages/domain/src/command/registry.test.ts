import { describe, expect, it } from 'vitest';
import * as domain from '../index';
import type { AnyCommand } from './define-command';
import { commands, getCommand } from './registry';

const isCommand = (value: unknown): value is AnyCommand =>
  typeof value === 'object' &&
  value !== null &&
  'name' in value &&
  'handler' in value &&
  'permission' in value;

describe('the command registry (AUDIT L16)', () => {
  it('lists every exported command once, under its own name', () => {
    const exported = (Object.values(domain) as unknown[]).filter(isCommand);
    expect(exported.length).toBeGreaterThan(5);
    const names = exported.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of exported) expect(getCommand(command.name)).toBe(command);
    for (const [key, command] of Object.entries(commands)) expect(command.name).toBe(key);
    expect(Object.keys(commands).sort()).toEqual([...names].sort());
  });

  it('each declares its audit fields once', () => {
    for (const command of Object.values(commands)) {
      const fields = command.auditFields;
      expect(new Set(fields).size, command.name).toBe(fields.length);
    }
  });

  it('names follow module.resource.action and refuse an unknown name', () => {
    for (const name of Object.keys(commands)) expect(name).toMatch(/^[a-z]+(\.[a-z_]+){2,3}$/);
    expect(() => getCommand('crm.lead.delete')).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    );
  });
});
