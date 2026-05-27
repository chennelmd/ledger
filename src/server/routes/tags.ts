import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';

export const tagsRouter = new Hono();

// GET /api/tags — list all tags with split usage count
tagsRouter.get('/', async (c) => {
  const rows = await db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
      usageCount: sql<number>`count(${schema.splitTags.tagId})`,
    })
    .from(schema.tags)
    .leftJoin(schema.splitTags, eq(schema.splitTags.tagId, schema.tags.id))
    .groupBy(schema.tags.id)
    .orderBy(schema.tags.name);

  return c.json(rows);
});

// GET /api/tags/:name — splits tagged with this tag, with transaction context
tagsRouter.get('/:name', async (c) => {
  const name = c.req.param('name');

  const tag = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.name, name))
    .get();

  if (!tag) return c.json({ error: 'not found' }, 404);

  const rows = await db
    .select({
      splitId: schema.transactionSplits.id,
      transactionId: schema.transactions.id,
      date: schema.transactions.date,
      amountCents: schema.transactionSplits.amountCents,
      categoryId: schema.transactionSplits.categoryId,
      categoryName: schema.categories.name,
      payeeName: schema.payees.name,
      accountName: schema.accounts.name,
    })
    .from(schema.splitTags)
    .innerJoin(schema.transactionSplits, eq(schema.splitTags.splitId, schema.transactionSplits.id))
    .innerJoin(schema.transactions, eq(schema.transactionSplits.transactionId, schema.transactions.id))
    .leftJoin(schema.categories, eq(schema.transactionSplits.categoryId, schema.categories.id))
    .leftJoin(schema.payees, eq(schema.transactions.payeeId, schema.payees.id))
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(eq(schema.splitTags.tagId, tag.id))
    .orderBy(schema.transactions.date);

  return c.json({ tag, rows });
});
