import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../../db/client.js';

export const payeesRouter = new Hono();

// GET /api/payees — list all payees
payeesRouter.get('/', async (c) => {
  const rows = await db
    .select()
    .from(schema.payees)
    .orderBy(schema.payees.name);

  return c.json(rows);
});

// POST /api/payees — upsert by name, return existing or newly created
payeesRouter.post('/', async (c) => {
  const body = await c.req.json();
  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const existing = await db
    .select()
    .from(schema.payees)
    .where(eq(schema.payees.name, name))
    .get();

  if (existing) return c.json(existing);

  const inserted = await db
    .insert(schema.payees)
    .values({ id: nanoid(), name })
    .returning()
    .get();

  return c.json(inserted, 201);
});
