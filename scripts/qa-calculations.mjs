import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH ?? './data/app.db';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const MONTH = process.env.QA_MONTH ?? new Date().toISOString().slice(0, 7);

const db = new Database(DB_PATH, { readonly: true });

const fmt = (cents) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function rows(sql, params = {}) {
  return db.prepare(sql).all(params);
}

async function api(path) {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function byId(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function monthKey(date) {
  return date.slice(0, 7);
}

function expectedAccountBalances() {
  return rows(`
    select
      a.id,
      a.name,
      a.starting_balance_cents as startingBalanceCents,
      coalesce(sum(t.amount_cents), 0) as transactionSumCents,
      a.starting_balance_cents + coalesce(sum(t.amount_cents), 0) as balanceCents
    from accounts a
    left join transactions t
      on t.account_id = a.id
      and t.deleted_at is null
    where a.deleted_at is null
    group by a.id
    order by a.sort_order, a.created_at
  `);
}

function activeCategories() {
  return rows(`
    select
      c.id,
      c.name,
      c.group_id as groupId,
      c.rollover_overspending as rolloverOverspending,
      g.name as groupName,
      g.is_income as groupIsIncome
    from categories c
    inner join category_groups g on g.id = c.group_id
    where c.is_hidden = 0
      and g.is_hidden = 0
    order by g.sort_order, c.sort_order
  `);
}

function budgetExpected(month) {
  const cats = activeCategories();
  const budgets = rows(`
    select month, category_id as categoryId, sum(assigned_cents) as assignedCents
    from budgets
    where month <= @month
    group by month, category_id
  `, { month });
  const activity = rows(`
    select
      substr(t.date, 1, 7) as month,
      s.category_id as categoryId,
      sum(s.amount_cents) as activityCents
    from transaction_splits s
    inner join transactions t on t.id = s.transaction_id
    where t.deleted_at is null
      and substr(t.date, 1, 7) <= @month
    group by substr(t.date, 1, 7), s.category_id
  `, { month });

  const assignedByMonth = new Map();
  for (const row of budgets) {
    if (!assignedByMonth.has(row.month)) assignedByMonth.set(row.month, new Map());
    assignedByMonth.get(row.month).set(row.categoryId, Number(row.assignedCents));
  }

  const activityByMonth = new Map();
  for (const row of activity) {
    if (!row.categoryId) continue;
    if (!activityByMonth.has(row.month)) activityByMonth.set(row.month, new Map());
    activityByMonth.get(row.month).set(row.categoryId, Number(row.activityCents));
  }

  const priorMonths = [...new Set([
    ...budgets.map((row) => row.month),
    ...activity.map((row) => row.month),
  ])]
    .filter((m) => m < month)
    .sort();

  const carryover = new Map();
  for (const m of priorMonths) {
    for (const cat of cats) {
      const assigned = assignedByMonth.get(m)?.get(cat.id) ?? 0;
      const monthActivity = activityByMonth.get(m)?.get(cat.id) ?? 0;
      const prior = carryover.get(cat.id) ?? 0;
      let balance = prior + assigned + monthActivity;
      if (!cat.rolloverOverspending && balance < 0) balance = 0;
      carryover.set(cat.id, balance);
    }
  }

  const thisMonthAssigned = assignedByMonth.get(month) ?? new Map();
  const thisMonthActivity = activityByMonth.get(month) ?? new Map();
  const categories = new Map();
  let totalExpenseAvailableCents = 0;

  for (const cat of cats) {
    const assignedCents = cat.groupIsIncome ? 0 : (thisMonthAssigned.get(cat.id) ?? 0);
    const activityCents = thisMonthActivity.get(cat.id) ?? 0;
    const availableCents = cat.groupIsIncome
      ? activityCents
      : (carryover.get(cat.id) ?? 0) + assignedCents + activityCents;

    if (!cat.groupIsIncome) totalExpenseAvailableCents += availableCents;
    categories.set(cat.id, {
      ...cat,
      assignedCents,
      activityCents,
      availableCents,
    });
  }

  const onBudgetBalance = rows(`
    select coalesce(sum(a.starting_balance_cents + coalesce(txn.net, 0)), 0) as balanceCents
    from accounts a
    left join (
      select account_id, sum(amount_cents) as net
      from transactions
      where deleted_at is null
      group by account_id
    ) txn on txn.account_id = a.id
    where a.deleted_at is null
      and a.is_on_budget = 1
  `)[0].balanceCents;

  return {
    readyToAssignCents: onBudgetBalance - totalExpenseAvailableCents,
    categories,
  };
}

function invariantChecks() {
  const splitMismatches = rows(`
    select
      t.id,
      t.date,
      t.amount_cents as amountCents,
      coalesce(sum(s.amount_cents), 0) as splitSumCents,
      count(s.id) as splitCount
    from transactions t
    left join transaction_splits s on s.transaction_id = t.id
    where t.deleted_at is null
    group by t.id
    having splitCount > 0 and splitSumCents != amountCents
  `);

  const transferMismatches = rows(`
    select
      transfer_id as transferId,
      count(*) as legCount,
      sum(amount_cents) as netCents
    from transactions
    where deleted_at is null
      and transfer_id is not null
    group by transfer_id
    having legCount != 2 or netCents != 0
  `);

  const uncategorizedNonTransfer = rows(`
    select t.id, t.date, t.amount_cents as amountCents, a.name as accountName
    from transactions t
    left join transaction_splits s on s.transaction_id = t.id
    left join accounts a on a.id = t.account_id
    where t.deleted_at is null
      and t.transfer_id is null
    group by t.id
    having count(s.id) = 0
  `);

  return { splitMismatches, transferMismatches, uncategorizedNonTransfer };
}

const failures = [];
const warnings = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

const [apiAccounts, apiBudget] = await Promise.all([
  api('/api/accounts'),
  api(`/api/budget/${MONTH}`),
]);

check('account API balances match independent SQL', () => {
  const apiMap = byId(apiAccounts);
  for (const expected of expectedAccountBalances()) {
    const actual = apiMap.get(expected.id);
    assert.ok(actual, `missing account ${expected.name}`);
    assert.equal(
      actual.balanceCents,
      expected.balanceCents,
      `${expected.name}: expected ${fmt(expected.balanceCents)}, got ${fmt(actual.balanceCents)}`,
    );
  }
});

check(`budget API calculations match independent SQL for ${MONTH}`, () => {
  const expected = budgetExpected(MONTH);
  assert.equal(
    apiBudget.readyToAssignCents,
    expected.readyToAssignCents,
    `RTA expected ${fmt(expected.readyToAssignCents)}, got ${fmt(apiBudget.readyToAssignCents)}`,
  );

  for (const group of apiBudget.groups) {
    for (const actual of group.categories) {
      const expectedCat = expected.categories.get(actual.id);
      assert.ok(expectedCat, `unexpected category ${actual.name}`);
      for (const field of ['assignedCents', 'activityCents', 'availableCents']) {
        assert.equal(
          actual[field],
          expectedCat[field],
          `${actual.name} ${field}: expected ${fmt(expectedCat[field])}, got ${fmt(actual[field])}`,
        );
      }
    }
  }
});

const invariants = invariantChecks();

check('active transaction splits sum to transaction amount', () => {
  assert.deepEqual(invariants.splitMismatches, []);
});

check('active transfer pairs have exactly two legs and net to zero', () => {
  assert.deepEqual(invariants.transferMismatches, []);
});

if (invariants.uncategorizedNonTransfer.length) {
  warnings.push({
    name: 'uncategorized non-transfer transactions',
    count: invariants.uncategorizedNonTransfer.length,
    examples: invariants.uncategorizedNonTransfer.slice(0, 5),
  });
}

const summary = {
  month: MONTH,
  accountCount: apiAccounts.length,
  budgetGroupCount: apiBudget.groups.length,
  failures,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
