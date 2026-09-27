import { describe, expect, it } from 'vitest';
import { assertLocalDatabase } from './local-database';

describe('assertLocalDatabase', () => {
  it.each([
    'postgres://postgres:pw@127.0.0.1:54322/postgres',
    'postgres://app_user:pw@localhost:5432/postgres',
    'postgres://app_user:pw@[::1]:5432/postgres',
  ])('accepts %s', (url) => {
    expect(() => {
      assertLocalDatabase(url, false);
    }).not.toThrow();
  });

  it.each([
    'postgres://postgres.abcd:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
    'postgres://postgres:pw@db.abcd.supabase.co:5432/postgres',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => {
      assertLocalDatabase(url, false);
    }).toThrow(/refusing/);
  });

  it('lets an explicit override through', () => {
    expect(() => {
      assertLocalDatabase('postgres://u:pw@db.abcd.supabase.co:5432/postgres', true);
    }).not.toThrow();
  });
});
