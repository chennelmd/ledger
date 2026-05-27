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

type CategoryBalance  = { id: string; name: string; groupName: string; availableCents: number };
type ScheduledOutflow = { id: string; name: string; date: string; categoryId: string; amountCents: number };
type ScheduleRow      = { id: string; name: string; categoryId: string | null; amountCents: number; rrule: string; nextOccurrence: string };

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function isMonth(v: string) { return /^\d{4}-\d{2}$/.test(v); }
function toDateOnly(d: Date) { return d.toISOString().slice(0, 10); }
function startOfToday() { return new Date(`${toDateOnly(new Date())}T00:00:00.000Z`); }

function prevMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Returns "YYYY-MM-DD" for the last calendar day of the given month.
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

function occurrencesBetween(rruleText: string, startDate: Date, endDate: Date) {
  return rrulestr(rruleText).between(startDate, endDate, true).map(toDateOnly);
}

// Compute uncovered scheduled outflows within [windowStart, windowEnd].
// "Uncovered" means the outflow exceeds the current envelope reserve for its category.
function computeScheduled(
  schedules: ScheduleRow[],
  windowStart: Date,
  windowEnd: Date,
  reserveByCategoryId: Map<string, number>,
): { uncoveredCents: number; totalCents: number; outflows: ScheduledOutflow[] } {
  const scheduledByCategoryId = new Map<string, number>();
  const outflows: ScheduledOutflow[] = [];

  for (const schedule of schedules) {
    if (!schedule.categoryId) continue;
    const dates = occurrencesBetween(schedule.rrule, windowStart, windowEnd)
      .filter((d) => d >= schedule.nextOccurrence);
    for (const date of dates) {
      const outflowCents = Math.max(0, -schedule.amountCents);
      if (outflowCents === 0) continue;
      outflows.push({ id: schedule.id, name: schedule.name, date, categoryId: schedule.categoryId, amountCents: schedule.amountCents });
      scheduledByCategoryId.set(schedule.categoryId, (scheduledByCategoryId.get(schedule.categoryId) ?? 0) + outflowCents);
    }
  }

  let uncoveredCents = 0;
  let totalCents = 0;
  for (const [categoryId, scheduledCents] of scheduledByCategoryId) {
    const reserveCents = reserveByCategoryId.get(categoryId) ?? 0;
    uncoveredCents += Math.max(0, scheduledCents - reserveCents);
    totalCents += scheduledCents;
  }
  outflows.sort((a, b) => a.date.localeCompare(b.date));
  return { uncoveredCents, totalCents, outflows };
}

// GET /api/dashboard/free-cash?month=YYYY-MM
dashboardRouter.get('/free-cash', async (c) => {
  const month = c.req.query('month') ?? currentMonth();
  if (!isMonth(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);

  const prevMonth    = prevMonthOf(month);
  const prevMonthEnd = lastDayOf(prevMonth);

  const [
    accounts,
    accountTxnSums,
    prevMonthAccountTxnSums,
    cats,
    assignedRows,
    activityRows,
    schedules,
  ] = await Promise.all([
    // 1. On-budget asset accounts (cash pool)
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

    // 2. All-time transaction sums per account (current balances)
    db.select({
      accountId: schema.transactions.accountId,
      net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)`,
    })
      .from(schema.transactions)
      .where(isNull(schema.transactions.deletedAt))
      .groupBy(schema.transactions.accountId),

    // 3. Transaction sums per account through end of previous month (for trend)
    db.select({
      accountId: schema.transactions.accountId,
      net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)`,
    })
      .from(schema.transactions)
      .where(and(
        isNull(schema.transactions.deletedAt),
        sql`${schema.transactions.date} <= ${prevMonthEnd}`,
      ))
      .groupBy(schema.transactions.accountId),

    // 4. Visible expense categories with group info
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

    // 5. Budget assignments through current month
    db.select({
      month: schema.budgets.month,
      categoryId: schema.budgets.categoryId,
      total: sql<number>`coalesce(sum(${schema.budgets.assignedCents}), 0)`,
    })
      .from(schema.budgets)
      .where(sql`${schema.budgets.month} <= ${month}`)
      .groupBy(schema.budgets.month, schema.budgets.categoryId),

    // 6. Spending activity through current month
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

    // 7. Active schedules for upcoming outflow projection
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

  // ── Current cash balances ─────────────────────────────────────────────────

  const accountTxnMap = new Map(accountTxnSums.map((r) => [r.accountId, Number(r.net)]));
  const cashAccounts = accounts
    .filter((a) => CASH_SUBTYPES.has(a.subtype))
    .map((a) => ({
      id: a.id,
      name: a.name,
      subtype: a.subtype,
      balanceCents: a.startingBalanceCents + (accountTxnMap.get(a.id) ?? 0),
    }));

  const cashBalanceCents = cashAccounts.reduce((sum, a) => sum + a.balanceCents, 0);

  // ── Envelope balance computation (cumulative through current month) ───────

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

  const allMonths = [...new Set([
    ...assignedRows.map((r) => r.month),
    ...activityRows.map((r) => r.month),
  ])].sort();

  // Walk all months up to and including current month, accumulating balances.
  const balanceMap = new Map<string, number>();
  for (const m of allMonths) {
    for (const cat of cats) {
      const assigned = assignedByMonth.get(m)?.get(cat.id) ?? 0;
      const activity = activityByMonth.get(m)?.get(cat.id) ?? 0;
      const prior    = balanceMap.get(cat.id) ?? 0;
      let balance    = prior + assigned + activity;
      if (m < month && !cat.rolloverOverspending && balance < 0) balance = 0;
      balanceMap.set(cat.id, balance);
    }
  }

  // Reserved = positive non-debt envelope balances (money that's spoken for).
  const categoryBalances: CategoryBalance[] = [];
  for (const cat of cats) {
    const availableCents = balanceMap.get(cat.id) ?? 0;
    if (availableCents <= 0 || cat.linkedDebtAccountId) continue;
    categoryBalances.push({ id: cat.id, name: cat.name, groupName: cat.groupName, availableCents });
  }
  categoryBalances.sort((a, b) => b.availableCents - a.availableCents);

  const reservedEnvelopeCents = categoryBalances.reduce((sum, c) => sum + c.availableCents, 0);
  const reserveByCategoryId   = new Map(categoryBalances.map((c) => [c.id, c.availableCents]));

  // ── Scheduled outflow projections ─────────────────────────────────────────

  const today   = startOfToday();
  const end30d  = new Date(today);
  end30d.setUTCDate(end30d.getUTCDate() + 30);
  const endEOM  = new Date(`${lastDayOf(month)}T23:59:59.000Z`);

  const now30 = computeScheduled(schedules, today, end30d, reserveByCategoryId);
  const nowEOM = computeScheduled(schedules, today, endEOM, reserveByCategoryId);

  // ── Previous month free cash (for trend direction) ────────────────────────

  const prevAccountTxnMap = new Map(prevMonthAccountTxnSums.map((r) => [r.accountId, Number(r.net)]));
  const prevCashBalanceCents = cashAccounts.reduce(
    (sum, a) => sum + a.startingBalanceCents + (prevAccountTxnMap.get(a.id) ?? 0),
    0,
  );

  // Reuse the same assignedByMonth / activityByMonth data, scoped to prevMonth.
  const prevBalanceMap = new Map<string, number>();
  for (const m of allMonths.filter((m) => m <= prevMonth)) {
    for (const cat of cats) {
      const assigned = assignedByMonth.get(m)?.get(cat.id) ?? 0;
      const activity = activityByMonth.get(m)?.get(cat.id) ?? 0;
      const prior    = prevBalanceMap.get(cat.id) ?? 0;
      let balance    = prior + assigned + activity;
      if (m < prevMonth && !cat.rolloverOverspending && balance < 0) balance = 0;
      prevBalanceMap.set(cat.id, balance);
    }
  }

  const prevReservedCents = cats.reduce((sum, cat) => {
    const avail = prevBalanceMap.get(cat.id) ?? 0;
    return avail > 0 && !cat.linkedDebtAccountId ? sum + avail : sum;
  }, 0);

  // Excludes scheduled outflows — those change window-to-window and would make trend noisy.
  const prevMonthNetCents = prevCashBalanceCents - prevReservedCents;

  return c.json({
    month,
    cashBalanceCents,
    reservedEnvelopeCents,
    // 30-day window
    scheduledOutflowsCents:          now30.totalCents,
    uncoveredScheduledOutflowsCents: now30.uncoveredCents,
    freeCashCents:                   cashBalanceCents - reservedEnvelopeCents - now30.uncoveredCents,
    // End-of-month window
    uncoveredScheduledOutflowsEOMCents: nowEOM.uncoveredCents,
    freeCashEOMCents:                   cashBalanceCents - reservedEnvelopeCents - nowEOM.uncoveredCents,
    // Trend signal: (cash − reserved) at end of previous month, no scheduled component
    prevMonthNetCents,
    cashAccounts,
    reservedCategories:     categoryBalances,
    upcomingScheduledOutflows: now30.outflows,
  });
});
