import { Hono } from 'hono';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db, schema } from '../../db/client.js';
import { NewAccountSchema, ReconcileSchema } from '../../shared/schemas.js';

export const accountsRouter = new Hono();

// GET /api/accounts — list all active accounts with computed live balance
accountsRouter.get('/', async (c) => {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(isNull(schema.accounts.deletedAt))
    .orderBy(schema.accounts.sortOrder);

  const linkedDebtCategories = await db
    .select({
      id: schema.categories.id,
      linkedDebtAccountId: schema.categories.linkedDebtAccountId,
    })
    .from(schema.categories)
    .where(isNull(schema.categories.deletedAt));

  // coalesce so sum() never returns null; Number() guards against string coercion
  const sums = await db
    .select({
      accountId: schema.transactions.accountId,
      net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)`,
    })
    .from(schema.transactions)
    .where(isNull(schema.transactions.deletedAt))
    .groupBy(schema.transactions.accountId);

  const sumMap = new Map(sums.map((s) => [s.accountId, Number(s.net)]));
  const debtCategoryMap = new Map(
    linkedDebtCategories
      .filter((category) => category.linkedDebtAccountId)
      .map((category) => [category.linkedDebtAccountId!, category.id]),
  );

  const enriched = rows.map((a) => ({
    ...a,
    balanceCents: a.startingBalanceCents + (sumMap.get(a.id) ?? 0),
    debtCategoryId: debtCategoryMap.get(a.id) ?? null,
  }));

  return c.json(enriched);
});

// GET /api/accounts/:id/reconcile — cleared balance for reconciliation UI
accountsRouter.get('/:id/reconcile', async (c) => {
  const id = c.req.param('id');

  const account = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)))
    .get();
  if (!account) return c.json({ error: 'not found' }, 404);

  const [sumRow, countRow] = await Promise.all([
    db.select({ net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)` })
      .from(schema.transactions)
      .where(and(
        eq(schema.transactions.accountId, id),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.cleared, true),
      ))
      .get(),

    db.select({ count: sql<number>`count(*)` })
      .from(schema.transactions)
      .where(and(
        eq(schema.transactions.accountId, id),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.cleared, true),
      ))
      .get(),
  ]);

  return c.json({
    clearedBalanceCents: account.startingBalanceCents + Number(sumRow?.net ?? 0),
    clearedCount: Number(countRow?.count ?? 0),
  });
});

// POST /api/accounts/:id/reconcile — apply statement balance; create adjustment if needed
accountsRouter.post('/:id/reconcile', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = ReconcileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const { statementBalanceCents } = parsed.data;

  const account = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)))
    .get();
  if (!account) return c.json({ error: 'not found' }, 404);

  const sumRow = await db
    .select({ net: sql<number>`coalesce(sum(${schema.transactions.amountCents}), 0)` })
    .from(schema.transactions)
    .where(and(
      eq(schema.transactions.accountId, id),
      isNull(schema.transactions.deletedAt),
      eq(schema.transactions.cleared, true),
    ))
    .get();

  const clearedBalanceCents = account.startingBalanceCents + Number(sumRow?.net ?? 0);
  const adjustmentCents = statementBalanceCents - clearedBalanceCents;
  const now = new Date().toISOString();

  const result = db.transaction((tx) => {
    let adjustmentId: string | null = null;

    if (adjustmentCents !== 0) {
      const adj = tx.insert(schema.transactions).values({
        id: nanoid(),
        accountId: id,
        date: now.slice(0, 10),
        amountCents: adjustmentCents,
        notes: 'Reconciliation adjustment',
        cleared: true,
        createdAt: now,
        updatedAt: now,
      }).returning().get();
      adjustmentId = adj.id;
    }

    // Lock all cleared-but-unreconciled transactions
    tx.update(schema.transactions)
      .set({ reconciled: true, updatedAt: now })
      .where(and(
        eq(schema.transactions.accountId, id),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.cleared, true),
        eq(schema.transactions.reconciled, false),
      ))
      .run();

    return { ok: true, adjustmentCents, adjustmentId };
  });

  return c.json(result);
});

// GET /api/accounts/:id — single account
accountsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)))
    .get();

  if (!row) return c.json({ error: 'not found' }, 404);

  const linkedDebtCategory = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.linkedDebtAccountId, id))
    .get();

  return c.json({ ...row, debtCategoryId: linkedDebtCategory?.id ?? null });
});

// POST /api/accounts — create
accountsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = NewAccountSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  }

  const {
    linkedDebtCategoryId,
    startingBalanceCategoryId,
    ...accountData
  } = parsed.data;
  const id = nanoid();
  const now = new Date().toISOString();

  const inserted = db.transaction((tx) => {
    let resolvedDebtCategoryId = startingBalanceCategoryId ?? linkedDebtCategoryId ?? null;
    const isOnBudgetLiability = accountData.isOnBudget && accountData.type === 'liability';
    const needsAutoCategory = !resolvedDebtCategoryId && isOnBudgetLiability;

    // Step 1: find/create the "Debt Payments" group if needed — safe before account exists
    // because categoryGroups has no FK reference to accounts.
    let debtGroupId: string | undefined;
    if (needsAutoCategory) {
      let debtGroup = tx
        .select()
        .from(schema.categoryGroups)
        .where(and(eq(schema.categoryGroups.name, 'Debt Payments'), isNull(schema.categoryGroups.deletedAt)))
        .get();

      if (!debtGroup) {
        const maxSort = tx
          .select({ v: sql<number>`coalesce(max(${schema.categoryGroups.sortOrder}), 0)` })
          .from(schema.categoryGroups)
          .get();
        debtGroup = tx
          .insert(schema.categoryGroups)
          .values({ id: nanoid(), name: 'Debt Payments', sortOrder: (maxSort?.v ?? 0) + 1 })
          .returning()
          .get();
      }
      debtGroupId = debtGroup.id;
    }

    // Step 2: insert the account so the FK on categories.linkedDebtAccountId is satisfiable.
    const willHaveDebtCategory = needsAutoCategory || !!resolvedDebtCategoryId;
    const needsStartingBalanceTx =
      isOnBudgetLiability &&
      accountData.startingBalanceCents !== 0 &&
      willHaveDebtCategory;

    const account = tx
      .insert(schema.accounts)
      .values({
        id,
        ...accountData,
        startingBalanceCents: needsStartingBalanceTx ? 0 : accountData.startingBalanceCents,
      })
      .returning()
      .get();

    // Step 3: auto-create the "Bank Card Debt" category now that the account row exists.
    if (needsAutoCategory && debtGroupId) {
      const maxCatSort = tx
        .select({ v: sql<number>`coalesce(max(${schema.categories.sortOrder}), 0)` })
        .from(schema.categories)
        .where(and(eq(schema.categories.groupId, debtGroupId), isNull(schema.categories.deletedAt)))
        .get();

      const cat = tx
        .insert(schema.categories)
        .values({
          id: nanoid(),
          groupId: debtGroupId,
          name: `Bank Card Debt – ${accountData.name}`,
          rolloverOverspending: true,
          linkedDebtAccountId: id,
          sortOrder: (maxCatSort?.v ?? 0) + 1,
        })
        .returning()
        .get();

      resolvedDebtCategoryId = cat.id;
    }

    // Step 4: post the starting-balance transaction against the resolved debt category.
    if (needsStartingBalanceTx && resolvedDebtCategoryId) {
      const date = accountData.startingBalanceDate ?? new Date().toISOString().slice(0, 10);
      const txn = tx
        .insert(schema.transactions)
        .values({
          id: nanoid(),
          accountId: id,
          date,
          amountCents: accountData.startingBalanceCents,
          cleared: true,
        })
        .returning()
        .get();

      tx.insert(schema.transactionSplits).values({
        id: nanoid(),
        transactionId: txn.id,
        amountCents: accountData.startingBalanceCents,
        categoryId: resolvedDebtCategoryId,
        sortOrder: 0,
      }).run();
    }

    // Step 5: for user-selected categories, update the linkage.
    if (linkedDebtCategoryId) {
      tx.update(schema.categories)
        .set({ linkedDebtAccountId: null, updatedAt: now })
        .where(eq(schema.categories.linkedDebtAccountId, id))
        .run();
      tx.update(schema.categories)
        .set({ linkedDebtAccountId: id, updatedAt: now })
        .where(eq(schema.categories.id, linkedDebtCategoryId))
        .run();
    }

    return account;
  });

  return c.json(inserted, 201);
});

// PATCH /api/accounts/:id — update
accountsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = NewAccountSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  }

  const { startingBalanceCategoryId: _startingBalanceCategoryId, linkedDebtCategoryId, ...accountData } = parsed.data;

  const updated = db.transaction((tx) => {
    const account = tx
      .update(schema.accounts)
      .set({ ...accountData, updatedAt: new Date().toISOString() })
      .where(eq(schema.accounts.id, id))
      .returning()
      .get();

    if (!account) return null;

    if (linkedDebtCategoryId !== undefined) {
      tx.update(schema.categories)
        .set({ linkedDebtAccountId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.categories.linkedDebtAccountId, id))
        .run();

      if (linkedDebtCategoryId) {
        tx.update(schema.categories)
          .set({ linkedDebtAccountId: id, updatedAt: new Date().toISOString() })
          .where(eq(schema.categories.id, linkedDebtCategoryId))
          .run();
      }
    }

    return account;
  });

  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

// DELETE /api/accounts/:id — soft delete
accountsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db
    .update(schema.accounts)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.accounts.id, id));

  return c.json({ ok: true });
});
