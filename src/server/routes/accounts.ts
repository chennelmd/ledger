import { Hono } from 'hono';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db, schema } from '../../db/client.js';
import { NewAccountSchema } from '../../shared/schemas.js';

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
    startingBalanceCategoryId = linkedDebtCategoryId,
    ...accountData
  } = parsed.data;
  const id = nanoid();

  // For on-budget liability accounts with pre-existing debt, a selected category lets the
  // starting balance become budget activity for the linked debt envelope.
  // Without this, assignments to the envelope grow its available balance forever while the
  // account balance never changes (payments are transfers), making RTA go deeply negative.
  // If no category is selected, keep the starting balance on the account instead of creating
  // an uncategorized ledger row.
  const needsStartingBalanceTx =
    accountData.isOnBudget &&
    accountData.type === 'liability' &&
    accountData.startingBalanceCents !== 0 &&
    !!startingBalanceCategoryId;

  const inserted = db.transaction((tx) => {
    const account = tx
      .insert(schema.accounts)
      .values({
        id,
        ...accountData,
        startingBalanceCents: needsStartingBalanceTx ? 0 : accountData.startingBalanceCents,
      })
      .returning()
      .get();

    if (needsStartingBalanceTx) {
      const date =
        accountData.startingBalanceDate ?? new Date().toISOString().slice(0, 10);
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
        categoryId: startingBalanceCategoryId ?? null,
        sortOrder: 0,
      }).run();
    }

    if (linkedDebtCategoryId) {
      tx.update(schema.categories)
        .set({ linkedDebtAccountId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.categories.linkedDebtAccountId, id))
        .run();
      tx.update(schema.categories)
        .set({ linkedDebtAccountId: id, updatedAt: new Date().toISOString() })
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
