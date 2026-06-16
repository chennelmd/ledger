import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || './data/app.db');

const groups = db.prepare('SELECT id, name, is_hidden, deleted_at FROM category_groups ORDER BY sort_order').all();
const cats = db.prepare('SELECT id, name, group_id, is_hidden, deleted_at FROM categories ORDER BY sort_order').all();

console.log('\n=== GROUPS ===');
for (const g of groups) {
  console.log(`[${g.id}] "${g.name}" hidden=${g.is_hidden} deleted=${g.deleted_at ?? 'no'}`);
}

console.log('\n=== CATEGORIES ===');
for (const c of cats) {
  const group = groups.find(g => g.id === c.group_id);
  const groupName = group ? group.name : '*** GROUP NOT FOUND ***';
  console.log(`[${c.id}] "${c.name}" group="${groupName}" hidden=${c.is_hidden} deleted=${c.deleted_at ?? 'no'}`);
}

db.close();
