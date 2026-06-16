import { Hono } from 'hono';
import { eq, or, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../../db/client.js';
import { NewCategoryGroupSchema, NewCategorySchema } from '../../shared/schemas.js';

export const categoriesRouter = new Hono();

// GET /api/categories/debug — all groups and categories with no filtering (diagnostic)
categoriesRouter.get('/debug', async (c) => {
  const [groups, cats] = await Promise.all([
    db.select().from(schema.categoryGroups).orderBy(schema.categoryGroups.sortOrder),
    db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
  ]);
  return c.json({
    groups: groups.map(g => ({ id: g.id, name: g.name, isHidden: g.isHidden, deletedAt: g.deletedAt })),
    categories: cats.map(c => ({ id: c.id, name: c.name, groupId: c.groupId, isHidden: c.isHidden, deletedAt: c.deletedAt })),
  });
});

// GET /api/categories/hidden — hidden/deleted groups and categories not shown on budget page
categoriesRouter.get('/hidden', async (c) => {
  const [allGroups, allCats] = await Promise.all([
    db.select().from(schema.categoryGroups).orderBy(schema.categoryGroups.sortOrder),
    db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
  ]);

  const allGroupIds = new Set(allGroups.map(g => g.id));
  const hiddenGroupIds = new Set(allGroups.filter(g => g.isHidden || g.deletedAt).map(g => g.id));

  // Hidden/deleted groups with their categories
  const hiddenGroups = allGroups
    .filter(g => g.isHidden || g.deletedAt)
    .map(g => ({ ...g, _orphanedCatsOnly: false, categories: allCats.filter(c => c.groupId === g.id) }));

  // Categories not in hiddenGroups that are themselves hidden/deleted OR whose group is gone
  const extraCats = allCats.filter(c =>
    !hiddenGroupIds.has(c.groupId) &&
    (c.isHidden || c.deletedAt || !allGroupIds.has(c.groupId))
  );

  // Group them by their parent group (or synthetic orphan bucket)
  const extraByGroup = new Map<string, typeof allCats>();
  for (const cat of extraCats) {
    const key = allGroupIds.has(cat.groupId) ? cat.groupId : '__orphan__';
    if (!extraByGroup.has(key)) extraByGroup.set(key, []);
    extraByGroup.get(key)!.push(cat);
  }

  const orphanResult = Array.from(extraByGroup.entries()).map(([groupId, cats]) => {
    if (groupId === '__orphan__') {
      return { id: '__orphan__', name: 'No Group', isHidden: false, deletedAt: null, sortOrder: 999, _orphanedCatsOnly: true, categories: cats };
    }
    const g = allGroups.find(g => g.id === groupId)!;
    return { ...g, _orphanedCatsOnly: true, categories: cats };
  });

  return c.json([...hiddenGroups, ...orphanResult]);
});

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

// POST /api/categories/groups/:id/restore — unhide and undelete a group
categoriesRouter.post('/groups/:id/restore', async (c) => {
  const id = c.req.param('id');
  const updated = await db
    .update(schema.categoryGroups)
    .set({ isHidden: false, deletedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.categoryGroups.id, id))
    .returning()
    .get();

  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
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

// POST /api/categories/:id/restore — unhide and undelete a category
categoriesRouter.post('/:id/restore', async (c) => {
  const id = c.req.param('id');
  const updated = await db
    .update(schema.categories)
    .set({ isHidden: false, deletedAt: null, updatedAt: new Date().toISOString() })
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
