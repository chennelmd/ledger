import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DB_PATH ?? path.resolve('./data/app.db');
const BACKUP_DIR = path.resolve(path.dirname(DB_PATH), 'backups');
const MAX_BACKUPS = 30;

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

function backupPath(reason: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(BACKUP_DIR, `app-${stamp}-${reason}.db`);
}

function pruneBackups() {
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter((file) => file.startsWith('app-') && file.endsWith('.db'))
    .sort();

  for (const file of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
    fs.rmSync(path.join(BACKUP_DIR, file), { force: true });
  }
}

async function backupDatabase(reason: string) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const destination = backupPath(reason);
  await sqlite.backup(destination);
  pruneBackups();
  return destination;
}

async function backupDatabaseOncePerDay(reason: string) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const hasTodayBackup = fs.readdirSync(BACKUP_DIR)
    .some((file) => file.includes(today) && file.endsWith(`-${reason}.db`));

  if (!hasTodayBackup) {
    await backupDatabase(reason);
  }
}

await backupDatabaseOncePerDay('startup');

const scheduleColumns = sqlite.prepare('PRAGMA table_info(schedules)').all() as Array<{ name: string }>;
if (!scheduleColumns.some((column) => column.name === 'transfer_account_id')) {
  await backupDatabase('before-schema-change');
  sqlite.prepare('ALTER TABLE schedules ADD COLUMN transfer_account_id text REFERENCES accounts(id)').run();
}

export const db = drizzle(sqlite, { schema });
export { schema };
export { backupDatabase };
