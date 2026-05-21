import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DB_PATH ?? path.resolve('./data/app.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const scheduleColumns = sqlite.prepare('PRAGMA table_info(schedules)').all() as Array<{ name: string }>;
if (!scheduleColumns.some((column) => column.name === 'transfer_account_id')) {
  sqlite.prepare('ALTER TABLE schedules ADD COLUMN transfer_account_id text REFERENCES accounts(id)').run();
}

export const db = drizzle(sqlite, { schema });
export { schema };
