import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const reason = process.argv[2] ?? 'manual';
const safeReason = reason
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'manual';

const dbPath = process.env.DB_PATH ?? path.resolve('./data/app.db');
const backupDir = path.resolve(path.dirname(dbPath), 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `app-${stamp}-${safeReason}.db`);

fs.mkdirSync(backupDir, { recursive: true });

const sqlite = new Database(dbPath, { readonly: true });
try {
  await sqlite.backup(backupPath);
  console.log(backupPath);
} finally {
  sqlite.close();
}
