import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';

const SOURCE_DB = './data/app.db';
const QA_DB = '/private/tmp/budget-calc-qa.db';
const PORT = 3100;
const API_BASE_URL = `http://localhost:${PORT}`;

await fs.copyFile(SOURCE_DB, QA_DB);

const db = new Database(QA_DB);
db.pragma('foreign_keys = OFF');

const clear = db.transaction(() => {
  for (const table of [
    'split_tags',
    'transaction_splits',
    'transactions',
    'budgets',
    'payees',
    'categories',
    'category_groups',
    'accounts',
  ]) {
    db.prepare(`delete from ${table}`).run();
  }
});
clear();

const insert = {
  account: db.prepare(`
    insert into accounts (
      id, name, type, subtype, is_on_budget, is_closed, starting_balance_cents,
      sort_order, created_at, updated_at
    ) values (
      @id, @name, @type, @subtype, @isOnBudget, 0, @startingBalanceCents,
      @sortOrder, datetime('now'), datetime('now')
    )
  `),
  group: db.prepare(`
    insert into category_groups (
      id, name, is_income, is_hidden, sort_order, created_at, updated_at
    ) values (
      @id, @name, @isIncome, 0, @sortOrder, datetime('now'), datetime('now')
    )
  `),
  category: db.prepare(`
    insert into categories (
      id, group_id, name, is_income, is_hidden, rollover_overspending,
      sort_order, created_at, updated_at
    ) values (
      @id, @groupId, @name, 0, 0, @rolloverOverspending,
      @sortOrder, datetime('now'), datetime('now')
    )
  `),
  budget: db.prepare(`
    insert into budgets (
      id, month, category_id, assigned_cents, created_at, updated_at
    ) values (
      @id, @month, @categoryId, @assignedCents, datetime('now'), datetime('now')
    )
  `),
  payee: db.prepare(`
    insert into payees (
      id, name, created_at, updated_at
    ) values (
      @id, @name, datetime('now'), datetime('now')
    )
  `),
  transaction: db.prepare(`
    insert into transactions (
      id, account_id, date, amount_cents, payee_id, notes, cleared, reconciled,
      transfer_id, created_at, updated_at
    ) values (
      @id, @accountId, @date, @amountCents, @payeeId, @notes, @cleared, 0,
      @transferId, datetime('now'), datetime('now')
    )
  `),
  split: db.prepare(`
    insert into transaction_splits (
      id, transaction_id, amount_cents, category_id, transfer_account_id, sort_order
    ) values (
      @id, @transactionId, @amountCents, @categoryId, @transferAccountId, @sortOrder
    )
  `),
};

const seed = db.transaction(() => {
  insert.account.run({
    id: 'checking',
    name: 'QA Checking',
    type: 'asset',
    subtype: 'checking',
    isOnBudget: 1,
    startingBalanceCents: 100000,
    sortOrder: 0,
  });
  insert.account.run({
    id: 'savings',
    name: 'QA Savings',
    type: 'asset',
    subtype: 'savings',
    isOnBudget: 1,
    startingBalanceCents: 50000,
    sortOrder: 1,
  });
  insert.account.run({
    id: 'card',
    name: 'QA Card',
    type: 'liability',
    subtype: 'credit_card',
    isOnBudget: 1,
    startingBalanceCents: 0,
    sortOrder: 2,
  });
  insert.account.run({
    id: 'home',
    name: 'QA Home Value',
    type: 'tracking',
    subtype: 'home_value',
    isOnBudget: 0,
    startingBalanceCents: 1000000,
    sortOrder: 3,
  });

  insert.group.run({ id: 'income-group', name: 'Income', isIncome: 1, sortOrder: 0 });
  insert.group.run({ id: 'expense-group', name: 'Expenses', isIncome: 0, sortOrder: 1 });

  insert.category.run({
    id: 'income-cat',
    groupId: 'income-group',
    name: 'Paycheck',
    rolloverOverspending: 0,
    sortOrder: 0,
  });
  insert.category.run({
    id: 'groceries',
    groupId: 'expense-group',
    name: 'Groceries',
    rolloverOverspending: 0,
    sortOrder: 0,
  });
  insert.category.run({
    id: 'dining',
    groupId: 'expense-group',
    name: 'Dining',
    rolloverOverspending: 0,
    sortOrder: 1,
  });
  insert.category.run({
    id: 'sinking',
    groupId: 'expense-group',
    name: 'Sinking Fund',
    rolloverOverspending: 1,
    sortOrder: 2,
  });

  for (const row of [
    ['b-jan-groceries', '2026-01', 'groceries', 30000],
    ['b-jan-dining', '2026-01', 'dining', 10000],
    ['b-jan-sinking', '2026-01', 'sinking', 10000],
    ['b-feb-groceries', '2026-02', 'groceries', 20000],
    ['b-feb-dining', '2026-02', 'dining', 5000],
    ['b-feb-sinking', '2026-02', 'sinking', 10000],
  ]) {
    insert.budget.run({
      id: row[0],
      month: row[1],
      categoryId: row[2],
      assignedCents: row[3],
    });
  }

  for (const row of [
    ['paycheck', 'QA Employer'],
    ['market', 'QA Market'],
    ['restaurant', 'QA Restaurant'],
    ['repair', 'QA Repair'],
  ]) {
    insert.payee.run({ id: row[0], name: row[1] });
  }

  const normalTxns = [
    ['t-income', 'checking', '2026-01-05', 200000, 'paycheck', 'income-cat'],
    ['t-groceries-jan', 'checking', '2026-01-08', -25000, 'market', 'groceries'],
    ['t-dining-jan', 'checking', '2026-01-09', -15000, 'restaurant', 'dining'],
    ['t-sinking-jan', 'checking', '2026-01-10', -12000, 'repair', 'sinking'],
    ['t-groceries-feb', 'checking', '2026-02-03', -5000, 'market', 'groceries'],
  ];
  for (const [id, accountId, date, amountCents, payeeId, categoryId] of normalTxns) {
    insert.transaction.run({
      id,
      accountId,
      date,
      amountCents,
      payeeId,
      notes: null,
      cleared: 1,
      transferId: null,
    });
    insert.split.run({
      id: `${id}-split`,
      transactionId: id,
      amountCents,
      categoryId,
      transferAccountId: null,
      sortOrder: 0,
    });
  }

  insert.transaction.run({
    id: 'transfer-out',
    accountId: 'checking',
    date: '2026-02-15',
    amountCents: -10000,
    payeeId: null,
    notes: 'Card payment',
    cleared: 1,
    transferId: 'transfer-card-payment',
  });
  insert.split.run({
    id: 'transfer-out-split',
    transactionId: 'transfer-out',
    amountCents: -10000,
    categoryId: null,
    transferAccountId: 'card',
    sortOrder: 0,
  });
  insert.transaction.run({
    id: 'transfer-in',
    accountId: 'card',
    date: '2026-02-15',
    amountCents: 10000,
    payeeId: null,
    notes: 'Card payment',
    cleared: 1,
    transferId: 'transfer-card-payment',
  });
  insert.split.run({
    id: 'transfer-in-split',
    transactionId: 'transfer-in',
    amountCents: 10000,
    categoryId: null,
    transferAccountId: 'checking',
    sortOrder: 0,
  });
});
seed();
db.pragma('foreign_keys = ON');
db.close();

const server = spawn('npx', ['tsx', 'src/server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, DB_PATH: QA_DB, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not start:\n${serverOutput}`);
}

async function get(path) {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

try {
  await waitForServer();
  const accounts = await get('/api/accounts');
  const budget = await get('/api/budget/2026-02');
  const account = Object.fromEntries(accounts.map((row) => [row.id, row]));
  const categories = Object.fromEntries(
    budget.groups.flatMap((group) => group.categories.map((cat) => [cat.id, cat])),
  );

  check('fixture account balances', () => {
    assert.equal(account.checking.balanceCents, 233000);
    assert.equal(account.savings.balanceCents, 50000);
    assert.equal(account.card.balanceCents, 10000);
    assert.equal(account.home.balanceCents, 1000000);
  });

  check('fixture transfer nets to zero across on-budget accounts', () => {
    const onBudgetBalance = accounts
      .filter((row) => row.isOnBudget)
      .reduce((sum, row) => sum + row.balanceCents, 0);
    assert.equal(onBudgetBalance, 293000);
  });

  check('fixture budget activity and carryover', () => {
    assert.equal(categories.groceries.assignedCents, 20000);
    assert.equal(categories.groceries.activityCents, -5000);
    assert.equal(categories.groceries.availableCents, 20000);

    assert.equal(categories.dining.assignedCents, 5000);
    assert.equal(categories.dining.activityCents, 0);
    assert.equal(categories.dining.availableCents, 5000);

    assert.equal(categories.sinking.assignedCents, 10000);
    assert.equal(categories.sinking.activityCents, 0);
    assert.equal(categories.sinking.availableCents, 8000);
  });

  check('fixture ready to assign', () => {
    assert.equal(budget.readyToAssignCents, 260000);
  });

  console.log(JSON.stringify({
    failures,
    expected: {
      onBudgetBalanceCents: 293000,
      readyToAssignCents: 260000,
      expenseAvailableCents: 33000,
    },
  }, null, 2));
} finally {
  server.kill('SIGTERM');
}

if (failures.length) process.exitCode = 1;
