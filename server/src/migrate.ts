import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/** Applies pending `db/migrations/*.sql` files in name order, each in its own transaction. */
export async function migrate(db: Db, log: (msg: string) => void = console.log) {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const { rows } = await db.query<{ name: string }>('select name from schema_migrations');
  const applied = new Set(rows.map(r => r.name));
  for (const name of fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [name]);
      await client.query('commit');
      log(`applied ${name}`);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createPool } = await import('./db');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  const db = createPool(url);
  await migrate(db);
  await db.end();
}
