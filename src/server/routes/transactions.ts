import { Hono } from 'hono';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
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
      splitId: schema.transactionSplits.id,
      splitAmountCents: schema.transactionSplits.amountCents,
      splitNotes: schema.transactionSplits.notes,
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

  // Fetch tags for all returned splits in one query
  const splitIds = rows.map(r => r.splitId).filter((id): id is string => id !== null);
  const tagsBySplitId = new Map<string, string[]>();
  if (splitIds.length > 0) {
    const tagRows = await db
      .select({ splitId: schema.splitTags.splitId, tagName: schema.tags.name })
      .from(schema.splitTags)
      .innerJoin(schema.tags, eq(schema.splitTags.tagId, schema.tags.id))
      .where(inArray(schema.splitTags.splitId, splitIds));
    for (const r of tagRows) {
      const arr = tagsBySplitId.get(r.splitId) ?? [];
      arr.push(r.tagName);
      tagsBySplitId.set(r.splitId, arr);
    }
  }

  return c.json(rows.map(r => ({ ...r, tags: r.splitId ? (tagsBySplitId.get(r.splitId) ?? []) : [] })));
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
  type SplitRow = { amountCents: number; categoryId: string | null; notes: string | null; sortOrder: number; tags: string[] };
  let splitsToInsert: SplitRow[] = [];
  if (data.splits && data.splits.length > 0) {
    splitsToInsert = data.splits.map((s, i) => ({
      amountCents: s.amountCents,
      categoryId: s.categoryId ?? null,
      notes: s.notes ?? null,
      sortOrder: i,
      tags: s.tags ?? [],
    }));
  } else if (data.categoryId) {
    splitsToInsert = [{ amountCents: data.amountCents, categoryId: data.categoryId, notes: null, sortOrder: 0, tags: data.tags ?? [] }];
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

    // 3. Insert splits (and their tags)
    for (const split of splitsToInsert) {
      const insertedSplit = tx.insert(schema.transactionSplits).values({
        id: nanoid(),
        transactionId: txn.id,
        amountCents: split.amountCents,
        categoryId: split.categoryId,
        notes: split.notes,
        sortOrder: split.sortOrder,
      }).returning().get();

      for (const tagName of split.tags) {
        const existing = tx.select().from(schema.tags).where(eq(schema.tags.name, tagName)).get();
        const tagId = existing
          ? existing.id
          : tx.insert(schema.tags).values({ id: nanoid(), name: tagName }).returning().get().id;
        tx.insert(schema.splitTags).values({ splitId: insertedSplit.id, tagId }).run();
      }
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

  const { date, amountCents, notes } = parsed.data;
  const now = new Date().toISOString();

  const result = db.transaction((tx) => {
    const legs = tx
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.transferId, transferId), isNull(schema.transactions.deletedAt)))
      .all();

    if (legs.length === 0) return null;
    if (legs.some((leg) => leg.reconciled)) {
      return { error: 'reconciled transfers cannot be edited' };
    }

    for (const leg of legs) {
      const setFields: Record<string, unknown> = { updatedAt: now };
      if (date) setFields.date = date;
      if (notes !== undefined) setFields.notes = notes;
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
  if (typeof result === 'object' && 'error' in result) return c.json({ error: result.error }, 400);
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
    const existingTransaction = tx
      .select({
        id: schema.transactions.id,
        reconciled: schema.transactions.reconciled,
      })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)))
      .get();
    if (!existingTransaction) return null;
    if (existingTransaction.reconciled) {
      return { error: 'reconciled transactions cannot be edited' };
    }

    const resizesExistingSingleSplit =
      txnFields.amountCents !== undefined && categoryId === undefined && !(splits && splits.length > 0);
    let existingSingleSplitId: string | undefined;

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

    if (resizesExistingSingleSplit) {
      const existingSplits = tx
        .select({
          id: schema.transactionSplits.id,
        })
        .from(schema.transactionSplits)
        .where(and(
          eq(schema.transactionSplits.transactionId, id),
          isNull(schema.transactionSplits.transferAccountId),
        ))
        .all();

      if (existingSplits.length !== 1) {
        return {
          error: 'amountCents update without categoryId or splits requires exactly one existing non-transfer split; send the full splits array for split transactions',
        };
      }

      existingSingleSplitId = existingSplits[0].id;
    }

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

      // Replace all non-transfer splits atomically (cascade deletes split_tags for old splits)
      tx.delete(schema.transactionSplits)
        .where(and(
          eq(schema.transactionSplits.transactionId, id),
          isNull(schema.transactionSplits.transferAccountId),
        )).run();
      for (let i = 0; i < splits.length; i++) {
        const insertedSplit = tx.insert(schema.transactionSplits).values({
          id: nanoid(),
          transactionId: id,
          amountCents: splits[i].amountCents,
          categoryId: splits[i].categoryId ?? null,
          notes: splits[i].notes ?? null,
          sortOrder: i,
        }).returning().get();
        for (const tagName of splits[i].tags ?? []) {
          const existing = tx.select().from(schema.tags).where(eq(schema.tags.name, tagName)).get();
          const tagId = existing
            ? existing.id
            : tx.insert(schema.tags).values({ id: nanoid(), name: tagName }).returning().get().id;
          tx.insert(schema.splitTags).values({ splitId: insertedSplit.id, tagId }).run();
        }
      }
    } else if (categoryId !== undefined) {
      // Single-split sync. Replace existing category splits so reducing a
      // multi-split transaction back to one row removes the old extra rows.
      tx.delete(schema.transactionSplits)
        .where(and(
          eq(schema.transactionSplits.transactionId, id),
          isNull(schema.transactionSplits.transferAccountId),
        )).run();

      if (categoryId) {
        tx.insert(schema.transactionSplits).values({
          id: nanoid(),
          transactionId: id,
          amountCents: txnFields.amountCents ?? updated.amountCents,
          categoryId,
          sortOrder: 0,
        }).run();
      }
    } else if (existingSingleSplitId) {
      tx.update(schema.transactionSplits)
        .set({ amountCents: updated.amountCents })
        .where(eq(schema.transactionSplits.id, existingSingleSplitId))
        .run();
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
    .select({
      transferId: schema.transactions.transferId,
      reconciled: schema.transactions.reconciled,
    })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)))
    .get();

  if (!txn) return c.json({ error: 'not found' }, 404);
  if (txn.reconciled) return c.json({ error: 'reconciled transactions cannot be deleted' }, 400);

  if (txn.transferId) {
    const transferLegs = await db
      .select({ reconciled: schema.transactions.reconciled })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.transferId, txn.transferId), isNull(schema.transactions.deletedAt)));
    if (transferLegs.some((leg) => leg.reconciled)) {
      return c.json({ error: 'reconciled transfers cannot be deleted' }, 400);
    }

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
