import { Hono } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import rrulePkg from 'rrule';
import { db, schema } from '../../db/client.js';

export const dashboardRouter = new Hono();
const { rrulestr } = rrulePkg;
const linkedDebtCategories = alias(schema.categories, 'linked_debt_categories');
const activityCategoryId = sql<string | null>`coalesce(${schema.transactionSplits.categoryId}, ${linkedDebtCategories.id})`;

const CASH_SUBTYPES = new Set(['checking', 'savings', 'cash']);

type CategoryBalance = {
  id: string;
  name: string;
  groupName: string;
  availableCents: number;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function isMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfToday() {
  return new Date(`${toDateOnly(new Date())}T00:00:00.000Z`);
}

function occurrencesBetween(rruleText: string, startDate: Date, endDate: Date) {
  return rrulestr(rruleText).between(startDate, endDate, true).map(toDateOnly);
}

// GET /api/dashboard/free-cash?month=YYYY-MM
dashboardRouter.get('/free-cash', async (c) => {
  const month = c.req.query('month') ?? currentMonth();
  if (!isMonth(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);

  const [
    accounts,
    accountTxnSums,
    cats,
    assignedRows,
    activityRows,
    schedules,
  ] = await Promise.all([
    db.select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      subtype: schema.accounts.subtype,
      startingBalanceCents: schema.accounts.startingBalanceCents,
    })
      .from(schema.accounts)
      .where(and(
        isNull(schema.accounts.deletedAt),
        eq(schema.accounts.isOnBudget, true),
        eq(schema.accounts.type, 'asset'),
      )),

    db.select({
      accountId: schema.transactions.accountId,
      net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)`,
    })
      .from(schema.transactions)
      .where(isNull(schema.transactions.deletedAt))
      .groupBy(schema.transactions.accountId),

    db.select({
      id: schema.categories.id,
      name: schema.categories.name,
      groupName: schema.categoryGroups.name,
      rolloverOverspending: schema.categories.rolloverOverspending,
      linkedDebtAccountId: schema.categories.linkedDebtAccountId,
    })
      .from(schema.categories)
      .innerJoin(schema.categoryGroups, eq(schema.categories.groupId, schema.categoryGroups.id))
      .where(and(
        eq(schema.categories.isHidden, false),
        eq(schema.categoryGroups.isHidden, false),
        eq(schema.categoryGroups.isIncome, false),
      ))
      .orderBy(schema.categoryGroups.sortOrder, schema.categories.sortOrder),

    db.select({
      month: schema.budgets.month,
      categoryId: schema.budgets.categoryId,
      total: sql<number>`coalesce(sum(${schema.budgets.assignedCents}), 0)`,
    })
      .from(schema.budgets)
      .where(sql`${schema.budgets.month} <= ${month}`)
      .groupBy(schema.budgets.month, schema.budgets.categoryId),

    db.select({
      month: sql<string>`strftime('%Y-%m', ${schema.transactions.date})`,
      categoryId: activityCategoryId,
      activity: sql<number>`coalesce(sum(${schema.transactionSplits.amountCents}), 0)`,
    })
      .from(schema.transactionSplits)
      .innerJoin(schema.transactions, eq(schema.transactionSplits.transactionId, schema.transactions.id))
      .leftJoin(linkedDebtCategories, eq(linkedDebtCategories.linkedDebtAccountId, schema.transactionSplits.transferAccountId))
      .where(and(
        isNull(schema.transactions.deletedAt),
        sql`strftime('%Y-%m', ${schema.transactions.date}) <= ${month}`,
      ))
      .groupBy(
        sql`strftime('%Y-%m', ${schema.transactions.date})`,
        activityCategoryId,
      ),

    db.select({
      id: schema.schedules.id,
      name: schema.schedules.name,
      categoryId: schema.schedules.categoryId,
      amountCents: schema.schedules.amountCents,
      rrule: schema.schedules.rrule,
      nextOccurrence: schema.schedules.nextOccurrence,
    })
      .from(schema.schedules)
      .where(and(
        isNull(schema.schedules.deletedAt),
        eq(schema.schedules.isActive, true),
      )),
  ]);

  const accountTxnMap = new Map(accountTxnSums.map((row) => [row.accountId, Number(row.net)]));
  const cashAccounts = accounts
    .filter((account) => CASH_SUBTYPES.has(account.subtype))
    .map((account) => ({
      id: account.id,
      name: account.name,
      subtype: account.subtype,
      balanceCents: account.startingBalanceCents + (accountTxnMap.get(account.id) ?? 0),
    }));

  const cashBalanceCents = cashAccounts.reduce((sum, account) => sum + account.balanceCents, 0);

  const assignedByMonth = new Map<string, Map<string, number>>();
  for (const row of assignedRows) {
    if (!assignedByMonth.has(row.month)) assignedByMonth.set(row.month, new Map());
    assignedByMonth.get(row.month)!.set(row.categoryId, Number(row.total));
  }

  const activityByMonth = new Map<string, Map<string, number>>();
  for (const row of activityRows) {
    if (!row.categoryId) continue;
    if (!activityByMonth.has(row.month)) activityByMonth.set(row.month, new Map());
    activityByMonth.get(row.month)!.set(row.categoryId, Number(row.activity));
  }

  const months = [...new Set([
    ...assignedRows.map((row) => row.month),
    ...activityRows.map((row) => row.month),
  ])].sort();

  const balanceMap = new Map<string, number>();
  const categoryBalances: CategoryBalance[] = [];

  for (const m of months) {
    for (const cat of cats) {
      const assigned = assignedByMonth.get(m)?.get(cat.id) ?? 0;
      const activity = activityByMonth.get(m)?.get(cat.id) ?? 0;
      const prior = balanceMap.get(cat.id) ?? 0;
      let balance = prior + assigned + activity;
      if (m < month && !cat.rolloverOverspending && balance < 0) balance = 0;
      balanceMap.set(cat.id, balance);
    }
  }

  for (const cat of cats) {
    const availableCents = balanceMap.get(cat.id) ?? 0;
    if (availableCents <= 0 || cat.linkedDebtAccountId) continue;
    categoryBalances.push({
      id: cat.id,
      name: cat.name,
      groupName: cat.groupName,
      availableCents,
    });
  }

  categoryBalances.sort((a, b) => b.availableCents - a.availableCents);

  const reservedEnvelopeCents = categoryBalances.reduce(
    (sum, cat) => sum + cat.availableCents,
    0,
  );
  const reserveByCategoryId = new Map(
    categoryBalances.map((cat) => [cat.id, cat.availableCents]),
  );

  const today = startOfToday();
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + 30);

  const scheduledByCategoryId = new Map<string, number>();
  const upcomingScheduledOutflows = [];

  for (const schedule of schedules) {
    if (!schedule.categoryId) continue;
    const dates = occurrencesBetween(schedule.rrule, today, endDate)
      .filter((date) => date >= schedule.nextOccurrence);
    for (const date of dates) {
      const outflowCents = Math.max(0, -schedule.amountCents);
      if (outflowCents === 0) continue;

      upcomingScheduledOutflows.push({
        id: schedule.id,
        name: schedule.name,
        date,
        categoryId: schedule.categoryId,
        amountCents: schedule.amountCents,
      });

      scheduledByCategoryId.set(
        schedule.categoryId,
        (scheduledByCategoryId.get(schedule.categoryId) ?? 0) + outflowCents,
      );
    }
  }

  let uncoveredScheduledOutflowsCents = 0;
  for (const [categoryId, scheduledCents] of scheduledByCategoryId) {
    const reserveCents = reserveByCategoryId.get(categoryId) ?? 0;
    uncoveredScheduledOutflowsCents += Math.max(0, scheduledCents - reserveCents);
  }

  const scheduledOutflowsCents = upcomingScheduledOutflows.reduce(
    (sum, row) => sum + Math.max(0, -row.amountCents),
    0,
  );

  upcomingScheduledOutflows.sort((a, b) => a.date.localeCompare(b.date));

  return c.json({
    month,
    cashBalanceCents,
    reservedEnvelopeCents,
    scheduledOutflowsCents,
    uncoveredScheduledOutflowsCents,
    freeCashCents: cashBalanceCents - reservedEnvelopeCents - uncoveredScheduledOutflowsCents,
    cashAccounts,
    reservedCategories: categoryBalances,
    upcomingScheduledOutflows,
  });
});
