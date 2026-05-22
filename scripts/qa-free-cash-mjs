// Free-Cash dashboard QA fixture.
// Seeds a deterministic dataset, then exercises the /api/dashboard/free-cash endpoint
// across a handful of scenarios to surface counting/double-counting bugs.

import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH ?? './data/app.db';
const API = process.env.API_BASE_URL ?? 'http://localhost:3000';

const db = new Database(DB_PATH);
db.pragma('foreign_keys = OFF');

// Wipe everything so each run starts clean.
const wipe = db.transaction(() => {
  for (const t of [
    'split_tags', 'transaction_splits', 'transactions', 'budgets',
    'payees', 'schedules', 'categories', 'category_groups', 'accounts',
  ]) db.prepare(`delete from ${t}`).run();
});
wipe();

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const currentMonth = todayISO.slice(0, 7);

// Schedule a weekly bill so the next occurrence falls within today..today+30.
const inFiveDays = new Date(today);
inFiveDays.setUTCDate(inFiveDays.getUTCDate() + 5);
const nextOcc = inFiveDays.toISOString().slice(0, 10);
const dtstart = nextOcc.replaceAll('-', '');
// Format matches what client/pages/SchedulesPage.tsx::rruleFor produces.
// FREQ=WEEKLY;INTERVAL=1 with DTSTART anchored at the next occurrence date.
const weeklyRrule = `DTSTART:${dtstart}T000000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1`;

const stmt = {
  account: db.prepare(`
    insert into accounts (id,name,type,subtype,is_on_budget,is_closed,starting_balance_cents,sort_order,created_at,updated_at)
    values (@id,@name,@type,@subtype,@isOnBudget,0,@starting,@sort,datetime('now'),datetime('now'))`),
  group: db.prepare(`
    insert into category_groups (id,name,is_income,is_hidden,sort_order,created_at,updated_at)
    values (@id,@name,@isIncome,0,@sort,datetime('now'),datetime('now'))`),
  category: db.prepare(`
    insert into categories (id,group_id,name,is_income,is_hidden,rollover_overspending,sort_order,created_at,updated_at)
    values (@id,@groupId,@name,0,0,@rollover,@sort,datetime('now'),datetime('now'))`),
  budget: db.prepare(`
    insert into budgets (id,month,category_id,assigned_cents,created_at,updated_at)
    values (@id,@month,@categoryId,@assigned,datetime('now'),datetime('now'))`),
  schedule: db.prepare(`
    insert into schedules (id,name,account_id,category_id,amount_cents,rrule,next_occurrence,is_active,auto_post,created_at,updated_at)
    values (@id,@name,@account,@category,@amount,@rrule,@next,1,0,datetime('now'),datetime('now'))`),
};

const seed = db.transaction(() => {
  stmt.account.run({ id: 'checking', name: 'Checking', type: 'asset', subtype: 'checking', isOnBudget: 1, starting: 500_00, sort: 0 });
  stmt.group.run({ id: 'g-bills', name: 'Bills', isIncome: 0, sort: 0 });
  // Two categories:
  //  - rent: fully funded ($800), upcoming schedule ($500) is covered
  //  - utilities: empty, schedule ($120) is uncovered
  stmt.category.run({ id: 'c-rent', groupId: 'g-bills', name: 'Rent', rollover: 0, sort: 0 });
  stmt.category.run({ id: 'c-util', groupId: 'g-bills', name: 'Utilities', rollover: 0, sort: 1 });
  stmt.budget.run({ id: 'b-rent', month: currentMonth, categoryId: 'c-rent', assigned: 800_00 });
  // utilities intentionally unassigned -> $0 reserve

  // Weekly recurring schedules — first occurrence in 5 days, recurring weekly.
  // After posting the first occurrence, the schedule stays active (next becomes +12 days),
  // and the RRULE still spans the 30-day window — so we can check whether the
  // already-posted occurrence is re-counted.
  stmt.schedule.run({
    id: 's-rent', name: 'Rent', account: 'checking', category: 'c-rent',
    amount: -500_00, rrule: weeklyRrule, next: nextOcc,
  });
  stmt.schedule.run({
    id: 's-util', name: 'Power', account: 'checking', category: 'c-util',
    amount: -120_00, rrule: weeklyRrule, next: nextOcc,
  });
});
seed();
db.pragma('foreign_keys = ON');
db.close();

async function get(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function fmt(c) { return (c/100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }

function dumpFreeCash(label, data) {
  console.log(`\n── ${label} ──`);
  console.log(`  month                          ${data.month}`);
  console.log(`  cashBalanceCents               ${fmt(data.cashBalanceCents)}`);
  console.log(`  reservedEnvelopeCents          ${fmt(data.reservedEnvelopeCents)}`);
  console.log(`  scheduledOutflowsCents         ${fmt(data.scheduledOutflowsCents)}`);
  console.log(`  uncoveredScheduledOutflowsCents${' '.repeat(0)} ${fmt(data.uncoveredScheduledOutflowsCents)}`);
  console.log(`  freeCashCents                  ${fmt(data.freeCashCents)}`);
  if (data.upcomingScheduledOutflows?.length) {
    console.log(`  upcomingScheduledOutflows:`);
    for (const o of data.upcomingScheduledOutflows) {
      console.log(`    - ${o.date} ${o.name.padEnd(8)} ${fmt(o.amountCents)}  (catId=${o.categoryId})`);
    }
  }
  console.log(`  reservedCategories:`);
  for (const c of data.reservedCategories) {
    console.log(`    - ${c.name.padEnd(10)} ${fmt(c.availableCents)}`);
  }
}

const results = [];
function expect(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, actual, expected, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  ${tag} ${name}: expected ${fmt(expected)}, got ${fmt(actual)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario A: baseline (nothing posted)
// Weekly schedule, 30-day window -> 4 occurrences per schedule:
//   Rent:      4 × -$500 = -$2,000
//   Utilities: 4 × -$120 = -$480
//   Total scheduledOutflowsCents = $2,480
// Reserves vs scheduled (uncovered = max(0, scheduled - reserve)):
//   Rent:      max(0, 2000 - 800) = 1200
//   Utilities: max(0, 480  - 0)   = 480
//   Total uncoveredScheduledOutflowsCents = $1,680
// freeCash = cash - reservedEnvelope - uncovered = 500 - 800 - 1680 = -$1,980
const a = await get('/api/dashboard/free-cash');
dumpFreeCash('A: baseline (nothing posted yet)', a);
console.log('  Assertions:');
expect('A.cashBalanceCents',                a.cashBalanceCents,                500_00);
expect('A.reservedEnvelopeCents',           a.reservedEnvelopeCents,           800_00);
expect('A.scheduledOutflowsCents',          a.scheduledOutflowsCents,          2480_00);
expect('A.uncoveredScheduledOutflowsCents', a.uncoveredScheduledOutflowsCents, 1680_00);
expect('A.freeCashCents',                   a.freeCashCents,                   500_00 - 800_00 - 1680_00);

// ─────────────────────────────────────────────────────────────────────────
// Scenario B: post the rent schedule (covered)
// After posting:
//   - cash drops by $500 (txn created, dated 5 days from now, no date filter on cash sum)
//   - rent reserve drops by $500 (current-month activity)
//   - schedule's next_occurrence advances to today+12, RRULE unchanged
//
// BUG 1 prediction: dashboard recomputes the RRULE between today..today+30 without
// reference to next_occurrence or to already-posted scheduleId transactions, so the
// posted today+5 occurrence is STILL counted in scheduledOutflowsCents.
//
// Expected if bug is present (current behaviour):
//   scheduledOutflowsCents = 2480 (unchanged)  -> 4 occurrences still counted
//   uncoveredRent = max(0, 2000 - 300) = 1700
//   uncoveredUtil = max(0, 480  - 0)   = 480
//   uncoveredTotal = 2180
//   freeCash = (500 - 500) - 300 - 2180 = -2480
//
// Expected if bug is fixed (occurrences filtered to >= nextOccurrence OR not yet posted):
//   scheduledOutflowsCents = 1980 (3 occurrences of rent + 4 of util = 1500 + 480)
//   uncoveredRent = max(0, 1500 - 300) = 1200
//   uncoveredUtil = max(0, 480  - 0)   = 480
//   uncoveredTotal = 1680
//   freeCash = 0 - 300 - 1680 = -1980  (same as scenario A — total claim unchanged)
//
// We assert the FIXED expectation; with the bug present, all four assertions fail.

const postRent = await fetch(`${API}/api/schedules/s-rent/post`, { method: 'POST' });
console.log(`\nPOST /api/schedules/s-rent/post -> ${postRent.status}`);
const postRentBody = await postRent.json();
if (postRentBody.error) console.log('  body:', postRentBody);

const b = await get('/api/dashboard/free-cash');
dumpFreeCash('B: after posting rent (covered schedule)', b);
console.log('  Assertions (expecting fixed behavior; failures here = Bug 1 confirmed):');
expect('B.cashBalanceCents',                b.cashBalanceCents,                0);
expect('B.reservedEnvelopeCents',           b.reservedEnvelopeCents,           300_00);
expect('B.scheduledOutflowsCents',          b.scheduledOutflowsCents,          1980_00);
expect('B.uncoveredScheduledOutflowsCents', b.uncoveredScheduledOutflowsCents, 1680_00);
expect('B.freeCashCents',                   b.freeCashCents,                   0 - 300_00 - 1680_00);

// ─────────────────────────────────────────────────────────────────────────
// Scenario C — Bug 2: PATCH /api/transactions/:id with only amountCents
// strips the existing category split.
//
// Setup: create a categorized transaction directly, then PATCH only its amount.
// Expectation if fixed: split still exists, still tied to the original category.
// Expectation if buggy: split row vanishes, transaction becomes uncategorized.

// Create a non-schedule transaction so we have something to PATCH.
const newTxn = await fetch(`${API}/api/transactions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    accountId: 'checking',
    date: todayISO,
    amountCents: -75_00,
    payeeName: 'Coffee shop',
    categoryId: 'c-util',  // any category that exists
  }),
});
const txnBody = await newTxn.json();
console.log(`\nPOST /api/transactions -> ${newTxn.status}, id=${txnBody.id}`);

// Sanity: confirm it shows up with a category
const beforeRows = await get(`/api/transactions?accountId=checking&limit=10`);
const beforeMine = beforeRows.find(r => r.id === txnBody.id);
console.log(`  before PATCH: categoryId=${beforeMine?.categoryId}, splitAmount=${beforeMine?.splitAmountCents}`);

// Patch ONLY amountCents — no categoryId in the payload
const patch = await fetch(`${API}/api/transactions/${txnBody.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ amountCents: -90_00 }),
});
console.log(`PATCH (amountCents only) -> ${patch.status}`);

// Now check what's in the DB
const checkDb = new Database(DB_PATH, { readonly: true });
const splits = checkDb.prepare(
  `select id, category_id, amount_cents from transaction_splits where transaction_id = ?`,
).all(txnBody.id);
const txnRow = checkDb.prepare(
  `select amount_cents from transactions where id = ?`,
).get(txnBody.id);
checkDb.close();

console.log(`  after PATCH: transaction.amount_cents=${txnRow?.amount_cents}, splits=${JSON.stringify(splits)}`);

console.log('  Assertions (expecting fixed behavior; failures = Bug 2 confirmed):');
expect('C.transaction.amount_cents', txnRow?.amount_cents ?? 0, -90_00);
results.push({
  name: 'C.split row preserved',
  pass: splits.length === 1,
  actual: splits.length,
  expected: 1,
});
console.log(`  ${splits.length === 1 ? 'PASS' : 'FAIL'} C.split row preserved: expected 1 row, got ${splits.length}`);

if (splits.length === 1) {
  results.push({
    name: 'C.split category preserved',
    pass: splits[0].category_id === 'c-util',
    actual: splits[0].category_id,
    expected: 'c-util',
  });
  console.log(`  ${splits[0].category_id === 'c-util' ? 'PASS' : 'FAIL'} C.split category preserved: expected c-util, got ${splits[0].category_id}`);

  results.push({
    name: 'C.split amount matches new transaction amount',
    pass: splits[0].amount_cents === -90_00,
    actual: splits[0].amount_cents,
    expected: -90_00,
  });
  console.log(`  ${splits[0].amount_cents === -90_00 ? 'PASS' : 'FAIL'} C.split amount matches new transaction amount: expected -9000, got ${splits[0].amount_cents}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
const failures = results.filter(r => !r.pass);
console.log(`Total assertions: ${results.length}, failures: ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.name}: expected ${fmt(f.expected)}, got ${fmt(f.actual)} (delta ${fmt(f.actual - f.expected)})`);
  }
  process.exitCode = 1;
}
