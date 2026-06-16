import { Hono } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';
import { db, schema } from '../../db/client.js';
import { BudgetAssignmentSchema } from '../../shared/schemas.js';

export const budgetRouter = new Hono();
const linkedDebtCategories = alias(schema.categories, 'linked_debt_categories');
const activityCategoryId = sql<string | null>`coalesce(${schema.transactionSplits.categoryId}, ${linkedDebtCategories.id})`;

// ─── GET /:month ──────────────────────────────────────────────────────────────
// Returns groups → categories, each enriched with assignedCents, activityCents,
// availableCents. Also returns a top-level readyToAssignCents.
// Month format: "YYYY-MM"

budgetRouter.get('/:month', async (c) => {
  const month = c.req.param('month');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: 'month must be YYYY-MM' }, 400);
  }

  // All eight queries are independent — run in parallel.
  const [
    groups,
    cats,
    thisMonthBudgets,
    perMonthAssignedRows,
    thisMonthActivityRows,
    perMonthActivityRows,
    onBudgetAccounts,
    onBudgetTxnSums,
  ] = await Promise.all([
    // 1. Visible, non-deleted category groups
    db.select().from(schema.categoryGroups)
      .where(and(isNull(schema.categoryGroups.deletedAt), eq(schema.categoryGroups.isHidden, false)))
      .orderBy(schema.categoryGroups.sortOrder),

    // 2. Visible, non-deleted categories
    db.select().from(schema.categories)
      .where(and(isNull(schema.categories.deletedAt), eq(schema.categories.isHidden, false)))
      .orderBy(schema.categories.sortOrder),

    // 3. This month's assignment rows — drives the editable Assigned column
    db.select().from(schema.budgets)
      .where(eq(schema.budgets.month, month)),

    // 4. Assignments per month per category through current month — used for carryover calc
    db.select({
      month: schema.budgets.month,
      categoryId: schema.budgets.categoryId,
      total: sql<number>`coalesce(sum(${schema.budgets.assignedCents}), 0)`,
    })
      .from(schema.budgets)
      .where(sql`${schema.budgets.month} <= ${month}`)
      .groupBy(schema.budgets.month, schema.budgets.categoryId),

    // 5. This month's spending — drives the Activity column
    db.select({
      categoryId: activityCategoryId,
      activity: sql<number>`coalesce(sum(${schema.transactionSplits.amountCents}), 0)`,
    })
      .from(schema.transactionSplits)
      .innerJoin(schema.transactions, eq(schema.transactionSplits.transactionId, schema.transactions.id))
      .leftJoin(linkedDebtCategories, eq(linkedDebtCategories.linkedDebtAccountId, schema.transactionSplits.transferAccountId))
      .where(and(
        isNull(schema.transactions.deletedAt),
        sql`strftime('%Y-%m', ${schema.transactions.date}) = ${month}`,
      ))
      .groupBy(activityCategoryId),

    // 6. Activity per month per category through current month — used for carryover calc
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

    // 7. On-budget ASSET accounts only (for RTA).
    // Liability balances represent debt, not spendable money — they're tracked on the Debt
    // page where debt categories live. Including them here would push RTA deeply negative
    // with no way for the user to offset it via budget assignments.
    db.select({ id: schema.accounts.id, startingBalanceCents: schema.accounts.startingBalanceCents })
      .from(schema.accounts)
      .where(and(
        isNull(schema.accounts.deletedAt),
        eq(schema.accounts.isOnBudget, true),
        eq(schema.accounts.type, 'asset'),
      )),

    // 8. Transaction sums for on-budget asset accounts only (for RTA)
    db.select({
      accountId: schema.transactions.accountId,
      net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)`,
    })
      .from(schema.transactions)
      .innerJoin(schema.accounts, and(
        eq(schema.transactions.accountId, schema.accounts.id),
        isNull(schema.accounts.deletedAt),
        eq(schema.accounts.isOnBudget, true),
        eq(schema.accounts.type, 'asset'),
      ))
      .where(isNull(schema.transactions.deletedAt))
      .groupBy(schema.transactions.accountId),
  ]);

  // Build lookup maps for display columns
  const thisMonthBudgetMap   = new Map(thisMonthBudgets.map((b) => [b.categoryId, b.assignedCents]));
  const thisMonthActivityMap = new Map(thisMonthActivityRows.map((r) => [r.categoryId, Number(r.activity)]));
  const onBudgetTxnMap       = new Map(onBudgetTxnSums.map((s) => [s.accountId, Number(s.net)]));

  // Build per-month maps for carryover computation: month → categoryId → cents
  const assignedByMonth = new Map<string, Map<string, number>>();
  for (const row of perMonthAssignedRows) {
    if (!assignedByMonth.has(row.month)) assignedByMonth.set(row.month, new Map());
    assignedByMonth.get(row.month)!.set(row.categoryId, Number(row.total));
  }
  const activityByMonth = new Map<string, Map<string, number>>();
  for (const row of perMonthActivityRows) {
    if (!row.categoryId) continue; // skip uncategorized splits
    if (!activityByMonth.has(row.month)) activityByMonth.set(row.month, new Map());
    activityByMonth.get(row.month)!.set(row.categoryId, Number(row.activity));
  }

  // Walk prior months in order, accumulating per-category carryover.
  // Categories with rolloverOverspending=false have their negative balance clamped to 0 at each
  // month boundary — overspending is forgiven rather than carried forward into the next month.
  const priorMonths = [...new Set([
    ...perMonthAssignedRows.map((r) => r.month),
    ...perMonthActivityRows.map((r) => r.month),
  ])]
    .filter((m) => m < month)
    .sort();

  const carryoverMap = new Map<string, number>(); // categoryId → balance carried into current month
  for (const m of priorMonths) {
    for (const cat of cats) {
      // Income categories carry no balance forward — their available is always just
      // "received this month." Skipping them here prevents stale activity from leaking
      // into future months if this loop is ever extended.
      if (cat.isIncome) continue;
      const assigned = assignedByMonth.get(m)?.get(cat.id) ?? 0;
      const activity = activityByMonth.get(m)?.get(cat.id) ?? 0;
      const prior    = carryoverMap.get(cat.id) ?? 0;
      let bal = prior + assigned + activity;
      if (!cat.rolloverOverspending && bal < 0) bal = 0;
      carryoverMap.set(cat.id, bal);
    }
  }

  // Total balance across all on-budget accounts (real-time — all transactions ever)
  const onBudgetBalance = onBudgetAccounts.reduce(
    (sum, a) => sum + a.startingBalanceCents + (onBudgetTxnMap.get(a.id) ?? 0),
    0,
  );

  // Assemble groups → categories
  let totalExpenseAvailableCents = 0;

  const enrichedGroups = groups.map((g) => {
    const groupCats = cats
      .filter((cat) => cat.groupId === g.id)
      .map((cat) => {
        // Assigned + Activity columns: this month only (what you're actively editing/reviewing)
        const assignedCents = g.isIncome ? 0 : (thisMonthBudgetMap.get(cat.id) ?? 0);
        const activityCents = thisMonthActivityMap.get(cat.id) ?? 0;

        let availableCents: number;
        if (g.isIncome) {
          // Income rows: show this month's received amount for reference; not deducted from RTA
          availableCents = activityCents;
        } else {
          // Expense rows: carryover from prior months + this month's assigned + activity
          availableCents = (carryoverMap.get(cat.id) ?? 0) + assignedCents + activityCents;
          // Debt categories are tracked on the Debt dashboard; exclude from RTA
          if (!cat.linkedDebtAccountId) totalExpenseAvailableCents += availableCents;
        }

        return { ...cat, assignedCents, activityCents, availableCents };
      });

    return { ...g, categories: groupCats };
  });

  // RTA = what's sitting in on-budget accounts minus what's already locked in expense envelopes.
  // This stays correct as months pass: new income raises the account balance; assigning it
  // raises envelope totals by the same amount, keeping RTA stable.
  const readyToAssignCents = onBudgetBalance - totalExpenseAvailableCents;

  return c.json({ month, readyToAssignCents, groups: enrichedGroups });
});

// ─── PUT /:month/:categoryId ──────────────────────────────────────────────────
// Upsert the assigned amount for a category in a month.

budgetRouter.put('/:month/:categoryId', async (c) => {
  const month = c.req.param('month');
  const categoryId = c.req.param('categoryId');

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: 'month must be YYYY-MM' }, 400);
  }

  const body = await c.req.json();
  const parsed = BudgetAssignmentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const { assignedCents } = parsed.data;
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(schema.budgets)
    .where(and(eq(schema.budgets.month, month), eq(schema.budgets.categoryId, categoryId)))
    .get();

  if (existing) {
    const updated = await db
      .update(schema.budgets)
      .set({ assignedCents, updatedAt: now })
      .where(eq(schema.budgets.id, existing.id))
      .returning()
      .get();
    return c.json(updated);
  }

  const inserted = await db
    .insert(schema.budgets)
    .values({ id: nanoid(), month, categoryId, assignedCents })
    .returning()
    .get();

  return c.json(inserted, 201);
});
