import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../../db/client.js';
import { NewCategoryGroupSchema, NewCategorySchema } from '../../shared/schemas.js';

export const categoriesRouter = new Hono();

// GET /api/categories — all groups with their categories nested
categoriesRouter.get('/', async (c) => {
  const groups = await db
    .select()
    .from(schema.categoryGroups)
    .where(eq(schema.categoryGroups.isHidden, false))
    .orderBy(schema.categoryGroups.sortOrder);

  const cats = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.isHidden, false))
    .orderBy(schema.categories.sortOrder);

  const result = groups.map((g) => ({
    ...g,
    categories: cats.filter((cat) => cat.groupId === g.id),
  }));

  return c.json(result);
});

// POST /api/categories/groups — create a group
categoriesRouter.post('/groups', async (c) => {
  const body = await c.req.json();
  const parsed = NewCategoryGroupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const inserted = await db
    .insert(schema.categoryGroups)
    .values({ id: nanoid(), ...parsed.data })
    .returning()
    .get();

  return c.json(inserted, 201);
});

// PATCH /api/categories/groups/:id — update a group
categoriesRouter.patch('/groups/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = NewCategoryGroupSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const updated = await db
    .update(schema.categoryGroups)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(schema.categoryGroups.id, id))
    .returning()
    .get();

  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

// POST /api/categories — create a category
categoriesRouter.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = NewCategorySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const inserted = await db
    .insert(schema.categories)
    .values({ id: nanoid(), ...parsed.data })
    .returning()
    .get();

  return c.json(inserted, 201);
});

// PATCH /api/categories/:id — update a category
categoriesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = NewCategorySchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const updated = await db
    .update(schema.categories)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(schema.categories.id, id))
    .returning()
    .get();

  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

// DELETE /api/categories/:id — hide (soft delete via isHidden)
categoriesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db
    .update(schema.categories)
    .set({ isHidden: true, updatedAt: new Date().toISOString() })
    .where(eq(schema.categories.id, id));

  return c.json({ ok: true });
});
