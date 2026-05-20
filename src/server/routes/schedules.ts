import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import rrulePkg from 'rrule';
import { db, schema } from '../../db/client.js';
import { NewScheduleSchema } from '../../shared/schemas.js';

export const schedulesRouter = new Hono();
const { rrulestr } = rrulePkg;

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function atStartOfDay(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function startOfToday() {
  return atStartOfDay(toDateOnly(new Date()));
}

function nextOccurrenceAfter(rruleText: string, fromDate = new Date(), inclusive = true) {
  const rule = rrulestr(rruleText);
  const next = rule.after(fromDate, inclusive);
  return next ? toDateOnly(next) : null;
}

function upcomingOccurrences(rruleText: string, startDate: Date, endDate: Date) {
  const rule = rrulestr(rruleText);
  return rule.between(startDate, endDate, true).map(toDateOnly);
}

// GET /api/schedules?days=30 — active schedules with upcoming occurrences
schedulesRouter.get('/', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
  const start = startOfToday();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);

  const rows = await db
    .select({
      id: schema.schedules.id,
      name: schema.schedules.name,
      accountId: schema.schedules.accountId,
      accountName: schema.accounts.name,
      categoryId: schema.schedules.categoryId,
      categoryName: schema.categories.name,
      amountCents: schema.schedules.amountCents,
      rrule: schema.schedules.rrule,
      nextOccurrence: schema.schedules.nextOccurrence,
      isActive: schema.schedules.isActive,
      autoPost: schema.schedules.autoPost,
      notes: schema.schedules.notes,
      createdAt: schema.schedules.createdAt,
    })
    .from(schema.schedules)
    .innerJoin(schema.accounts, eq(schema.schedules.accountId, schema.accounts.id))
    .leftJoin(schema.categories, eq(schema.schedules.categoryId, schema.categories.id))
    .where(isNull(schema.schedules.deletedAt))
    .orderBy(schema.schedules.nextOccurrence);

  const enriched = rows.map((row) => ({
    ...row,
    upcomingOccurrences: row.isActive ? upcomingOccurrences(row.rrule, start, end) : [],
  }));

  return c.json(enriched);
});

// POST /api/schedules — create a schedule
schedulesRouter.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = NewScheduleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const data = parsed.data;
  const next = nextOccurrenceAfter(data.rrule, atStartOfDay(data.nextOccurrence));
  if (!next) return c.json({ error: 'rrule has no future occurrences' }, 400);

  const inserted = await db
    .insert(schema.schedules)
    .values({
      id: nanoid(),
      ...data,
      nextOccurrence: next,
    })
    .returning()
    .get();

  return c.json(inserted, 201);
});

// POST /api/schedules/:id/post — create the next scheduled transaction
schedulesRouter.post('/:id/post', async (c) => {
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const result = db.transaction((tx) => {
    const schedule = tx
      .select()
      .from(schema.schedules)
      .where(and(eq(schema.schedules.id, id), isNull(schema.schedules.deletedAt)))
      .get();

    if (!schedule) return null;
    if (!schedule.isActive) return { error: 'schedule is inactive' };

    const existingPost = tx
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(and(
        eq(schema.transactions.scheduleId, schedule.id),
        eq(schema.transactions.date, schedule.nextOccurrence),
        isNull(schema.transactions.deletedAt),
      ))
      .get();

    if (existingPost) return { error: 'schedule occurrence is already posted' };

    let payeeId: string | null = schedule.payeeId ?? null;
    if (!payeeId) {
      const existingPayee = tx
        .select()
        .from(schema.payees)
        .where(eq(schema.payees.name, schedule.name))
        .get();

      payeeId = existingPayee
        ? existingPayee.id
        : tx.insert(schema.payees).values({ id: nanoid(), name: schedule.name }).returning().get().id;
    }

    const txn = tx
      .insert(schema.transactions)
      .values({
        id: nanoid(),
        accountId: schedule.accountId,
        date: schedule.nextOccurrence,
        amountCents: schedule.amountCents,
        payeeId,
        notes: schedule.notes ?? null,
        cleared: false,
        scheduleId: schedule.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    tx.insert(schema.transactionSplits).values({
      id: nanoid(),
      transactionId: txn.id,
      amountCents: schedule.amountCents,
      categoryId: schedule.categoryId,
      sortOrder: 0,
    }).run();

    const next = nextOccurrenceAfter(schedule.rrule, atStartOfDay(schedule.nextOccurrence), false);
    const scheduleFields: Record<string, unknown> = { updatedAt: now };
    if (next) {
      scheduleFields.nextOccurrence = next;
    } else {
      scheduleFields.isActive = false;
    }

    const updatedSchedule = tx
      .update(schema.schedules)
      .set(scheduleFields)
      .where(eq(schema.schedules.id, schedule.id))
      .returning()
      .get();

    return { transaction: txn, schedule: updatedSchedule };
  });

  if (!result) return c.json({ error: 'not found' }, 404);
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json(result, 201);
});

// PATCH /api/schedules/:id — update a schedule
schedulesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = NewScheduleSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);

  const patch = parsed.data;
  const setFields: Record<string, unknown> = {
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  if (patch.rrule || patch.nextOccurrence) {
    const existing = await db
      .select()
      .from(schema.schedules)
      .where(and(eq(schema.schedules.id, id), isNull(schema.schedules.deletedAt)))
      .get();
    if (!existing) return c.json({ error: 'not found' }, 404);

    const rruleText = patch.rrule ?? existing.rrule;
    const fromDate = atStartOfDay(patch.nextOccurrence ?? existing.nextOccurrence);
    const next = nextOccurrenceAfter(rruleText, fromDate);
    if (!next) return c.json({ error: 'rrule has no future occurrences' }, 400);
    setFields.nextOccurrence = next;
  }

  const updated = await db
    .update(schema.schedules)
    .set(setFields)
    .where(and(eq(schema.schedules.id, id), isNull(schema.schedules.deletedAt)))
    .returning()
    .get();

  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

// DELETE /api/schedules/:id — soft delete
schedulesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db
    .update(schema.schedules)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.schedules.id, id));

  return c.json({ ok: true });
});
