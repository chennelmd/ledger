import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';
import { db, schema } from '../../db/client.js';
import { NewTransactionSchema, NewTransferSchema, TransferUpdateSchema } from '../../shared/schemas.js';

export const transactionsRouter = new Hono();

const transferAccounts = alias(schema.accounts, 'transfer_accounts');

function validateSplitsSum(splits: { amountCents: number }[], total: number): string | null {
  const sum = splits.reduce((s, r) => s + r.amountCents, 0);
  return sum === total ? null : `splits sum (${sum}) must equal amountCents (${total})`;
}

// GET /api/transactions?accountId=&limit= — list with payee + category joined
// Assumes single-split transactions (v1 constraint enforced by the UI)
transactionsRouter.get('/', async (c) => {
  const accountId = c.req.query('accountId');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);

  const conditions = [isNull(schema.transactions.deletedAt)];
  if (accountId) conditions.push(eq(schema.transactions.accountId, accountId));

  const rows = await db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      accountName: schema.accounts.name,
      date: schema.transactions.date,
      amountCents: schema.transactions.amountCents,
      payeeId: schema.transactions.payeeId,
      payeeName: schema.payees.name,
      notes: schema.transactions.notes,
      cleared: schema.transactions.cleared,
      reconciled: schema.transactions.reconciled,
      categoryId: schema.transactionSplits.categoryId,
      categoryName: schema.categories.name,
      splitAmountCents: schema.transactionSplits.amountCents,
      transferId: schema.transactions.transferId,
      transferAccountName: transferAccounts.name,
      createdAt: schema.transactions.createdAt,
    })
    .from(schema.transactions)
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .leftJoin(schema.payees, eq(schema.transactions.payeeId, schema.payees.id))
    .leftJoin(schema.transactionSplits, eq(schema.transactionSplits.transactionId, schema.transactions.id))
    .leftJoin(schema.categories, eq(schema.transactionSplits.categoryId, schema.categories.id))
    .leftJoin(transferAccounts, eq(schema.transactionSplits.transferAccountId, transferAccounts.id))
    .where(and(...conditions))
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
    .limit(limit);

  return c.json(rows);
});

// POST /api/transactions — create transaction + optional split, atomic
transactionsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = NewTransactionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const data = parsed.data;

  if (data.splits && data.splits.length > 0) {
    const err = validateSplitsSum(data.splits, data.amountCents);
    if (err) return c.json({ error: err }, 400);
  }

  // Normalise to a splits array for the insert loop
  type SplitRow = { amountCents: number; categoryId: string | null; sortOrder: number };
  let splitsToInsert: SplitRow[] = [];
  if (data.splits && data.splits.length > 0) {
    splitsToInsert = data.splits.map((s, i) => ({
      amountCents: s.amountCents,
      categoryId: s.categoryId ?? null,
      sortOrder: i,
    }));
  } else if (data.categoryId) {
    splitsToInsert = [{ amountCents: data.amountCents, categoryId: data.categoryId, sortOrder: 0 }];
  }

  const result = db.transaction((tx) => {
    // 1. Upsert payee by name if provided
    let payeeId = data.payeeId ?? null;
    if (data.payeeName) {
      const existing = tx
        .select()
        .from(schema.payees)
        .where(eq(schema.payees.name, data.payeeName))
        .get();

      payeeId = existing
        ? existing.id
        : tx.insert(schema.payees).values({ id: nanoid(), name: data.payeeName }).returning().get().id;
    }

    // 2. Insert transaction
    const txn = tx
      .insert(schema.transactions)
      .values({
        id: nanoid(),
        accountId: data.accountId,
        date: data.date,
        amountCents: data.amountCents,
        payeeId,
        notes: data.notes,
        cleared: data.cleared,
      })
      .returning()
      .get();

    // 3. Insert splits
    for (const split of splitsToInsert) {
      tx.insert(schema.transactionSplits).values({
        id: nanoid(),
        transactionId: txn.id,
        amountCents: split.amountCents,
        categoryId: split.categoryId,
        sortOrder: split.sortOrder,
      }).run();
    }

    return txn;
  });

  return c.json(result, 201);
});

// POST /api/transactions/transfer — atomically create both legs of a transfer
transactionsRouter.post('/transfer', async (c) => {
  const body = await c.req.json();
  const parsed = NewTransferSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const { fromAccountId, toAccountId, date, amountCents, notes, cleared } = parsed.data;

  if (fromAccountId === toAccountId) {
    return c.json({ error: 'cannot transfer to the same account' }, 400);
  }

  const transferId = nanoid();
  const now = new Date().toISOString();

  const result = db.transaction((tx) => {
    // Outgoing leg: negative on source account
    const fromTxn = tx.insert(schema.transactions).values({
      id: nanoid(),
      accountId: fromAccountId,
      date,
      amountCents: -amountCents,
      notes: notes ?? null,
      cleared: cleared ?? false,
      transferId,
      createdAt: now,
      updatedAt: now,
    }).returning().get();

    tx.insert(schema.transactionSplits).values({
      id: nanoid(),
      transactionId: fromTxn.id,
      amountCents: -amountCents,
      transferAccountId: toAccountId,
      sortOrder: 0,
    }).run();

    // Incoming leg: positive on destination account
    const toTxn = tx.insert(schema.transactions).values({
      id: nanoid(),
      accountId: toAccountId,
      date,
      amountCents,
      notes: notes ?? null,
      cleared: cleared ?? false,
      transferId,
      createdAt: now,
      updatedAt: now,
    }).returning().get();

    tx.insert(schema.transactionSplits).values({
      id: nanoid(),
      transactionId: toTxn.id,
      amountCents,
      transferAccountId: fromAccountId,
      sortOrder: 0,
    }).run();

    return { fromTxn, toTxn };
  });

  return c.json(result, 201);
});

// PATCH /api/transactions/transfer/:transferId — update both legs of a transfer atomically
transactionsRouter.patch('/transfer/:transferId', async (c) => {
  const transferId = c.req.param('transferId');
  const body = await c.req.json();
  const parsed = TransferUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const { date, amountCents } = parsed.data;
  const now = new Date().toISOString();

  const result = db.transaction((tx) => {
    const legs = tx
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.transferId, transferId), isNull(schema.transactions.deletedAt)))
      .all();

    if (legs.length === 0) return null;

    for (const leg of legs) {
      const setFields: Record<string, unknown> = { updatedAt: now };
      if (date) setFields.date = date;
      if (amountCents !== undefined) {
        // Preserve sign: the outgoing leg is negative, incoming is positive
        setFields.amountCents = leg.amountCents < 0 ? -amountCents : amountCents;
      }
      tx.update(schema.transactions).set(setFields).where(eq(schema.transactions.id, leg.id)).run();

      if (amountCents !== undefined) {
        const split = tx
          .select()
          .from(schema.transactionSplits)
          .where(eq(schema.transactionSplits.transactionId, leg.id))
          .get();
        if (split) {
          const newSplitAmount = leg.amountCents < 0 ? -amountCents : amountCents;
          tx.update(schema.transactionSplits).set({ amountCents: newSplitAmount })
            .where(eq(schema.transactionSplits.id, split.id)).run();
        }
      }
    }

    return true;
  });

  if (!result) return c.json({ error: 'transfer not found' }, 404);
  return c.json({ ok: true });
});

// PATCH /api/transactions/:id — partial update; handles payee upsert + split sync
transactionsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = NewTransactionSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const { payeeName, categoryId, splits, ...txnFields } = parsed.data;
  const now = new Date().toISOString();

  const result = db.transaction((tx) => {
    // Upsert payee by name if provided
    let resolvedPayeeId: string | undefined;
    if (payeeName) {
      const existing = tx.select().from(schema.payees).where(eq(schema.payees.name, payeeName)).get();
      resolvedPayeeId = existing
        ? existing.id
        : tx.insert(schema.payees).values({ id: nanoid(), name: payeeName }).returning().get().id;
    }

    const setFields: Record<string, unknown> = { ...txnFields, updatedAt: now };
    if (resolvedPayeeId !== undefined) setFields.payeeId = resolvedPayeeId;

    const updated = tx
      .update(schema.transactions)
      .set(setFields)
      .where(eq(schema.transactions.id, id))
      .returning()
      .get();

    if (!updated) return null;

    if (splits && splits.length > 0) {
      const err = validateSplitsSum(splits, updated.amountCents);
      if (err) return { error: err };

      // Replace all non-transfer splits atomically
      tx.delete(schema.transactionSplits)
        .where(and(
          eq(schema.transactionSplits.transactionId, id),
          isNull(schema.transactionSplits.transferAccountId),
        )).run();
      for (let i = 0; i < splits.length; i++) {
        tx.insert(schema.transactionSplits).values({
          id: nanoid(),
          transactionId: id,
          amountCents: splits[i].amountCents,
          categoryId: splits[i].categoryId ?? null,
          sortOrder: i,
        }).run();
      }
    } else if (categoryId !== undefined || txnFields.amountCents !== undefined) {
      // Single-split sync
      const existingSplit = tx
        .select()
        .from(schema.transactionSplits)
        .where(and(
          eq(schema.transactionSplits.transactionId, id),
          isNull(schema.transactionSplits.transferAccountId),
        ))
        .get();

      const splitSet: Record<string, unknown> = {};
      if (categoryId !== undefined) splitSet.categoryId = categoryId || null;
      if (txnFields.amountCents !== undefined) splitSet.amountCents = txnFields.amountCents;

      if (existingSplit) {
        tx.update(schema.transactionSplits).set(splitSet).where(eq(schema.transactionSplits.id, existingSplit.id)).run();
      } else if (categoryId) {
        tx.insert(schema.transactionSplits).values({
          id: nanoid(),
          transactionId: id,
          amountCents: txnFields.amountCents ?? updated.amountCents,
          categoryId,
          sortOrder: 0,
        }).run();
      }
    }

    return updated;
  });

  if (!result) return c.json({ error: 'not found' }, 404);
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

// DELETE /api/transactions/:id — soft delete; cascades to the other leg if this is a transfer
transactionsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const txn = await db
    .select({ transferId: schema.transactions.transferId })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)))
    .get();

  if (!txn) return c.json({ error: 'not found' }, 404);

  if (txn.transferId) {
    await db
      .update(schema.transactions)
      .set({ deletedAt: now })
      .where(eq(schema.transactions.transferId, txn.transferId));
  } else {
    await db
      .update(schema.transactions)
      .set({ deletedAt: now })
      .where(eq(schema.transactions.id, id));
  }

  return c.json({ ok: true });
});
