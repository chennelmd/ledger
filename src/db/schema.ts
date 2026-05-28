import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════
// Drizzle schema — translates schema.sql v0.3 into TypeScript.
// Source of truth for both DB structure and TS types.
// ═══════════════════════════════════════════════════════════════════

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
};

// ─────────────────────────────────────────────────────────────────
// ACCOUNTS
// ─────────────────────────────────────────────────────────────────

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['asset', 'liability', 'tracking'] }).notNull(),
  subtype: text('subtype').notNull(),
  isOnBudget: integer('is_on_budget', { mode: 'boolean' }).notNull().default(true),
  isClosed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),

  startingBalanceCents: integer('starting_balance_cents').notNull().default(0),
  startingBalanceDate: text('starting_balance_date'),

  // Debt metadata
  isRevolving: integer('is_revolving', { mode: 'boolean' }),
  rateType: text('rate_type', { enum: ['fixed', 'variable', 'promotional'] }),
  // APR stored as decimal fraction: 0.2499 = 24.99%. Multiply by 100 for display; use as-is in math (balance * apr / 12 for monthly interest).
  apr: real('apr'),
  standardApr: real('standard_apr'),
  promoEndDate: text('promo_end_date'),
  minPaymentCents: integer('min_payment_cents'),
  statementDay: integer('statement_day'),
  dueDay: integer('due_day'),
  creditLimitCents: integer('credit_limit_cents'),

  // Reconciliation
  lastReconciledAt: text('last_reconciled_at'),
  lastReconciledBalanceCents: integer('last_reconciled_balance_cents'),

  sortOrder: integer('sort_order').notNull().default(0),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  typeIdx: index('idx_accounts_type').on(t.type, t.subtype),
  activeIdx: index('idx_accounts_active').on(t.deletedAt, t.isClosed, t.sortOrder),
}));

// ─────────────────────────────────────────────────────────────────
// CATEGORY GROUPS
// ─────────────────────────────────────────────────────────────────

export const categoryGroups = sqliteTable('category_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isIncome: integer('is_income', { mode: 'boolean' }).notNull().default(false),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

// ─────────────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────────────

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => categoryGroups.id),
  name: text('name').notNull(),
  isIncome: integer('is_income', { mode: 'boolean' }).notNull().default(false),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),

  rolloverOverspending: integer('rollover_overspending', { mode: 'boolean' }).notNull().default(false),
  linkedDebtAccountId: text('linked_debt_account_id').references(() => accounts.id),

  goalType: text('goal_type', { enum: ['target_by_date', 'monthly_minimum', 'monthly_savings'] }),
  goalAmountCents: integer('goal_amount_cents'),
  goalDate: text('goal_date'),

  sortOrder: integer('sort_order').notNull().default(0),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  groupIdx: index('idx_categories_group').on(t.groupId, t.sortOrder),
  linkedDebtIdx: index('idx_categories_linked_debt').on(t.linkedDebtAccountId),
}));

// ─────────────────────────────────────────────────────────────────
// PAYEES
// ─────────────────────────────────────────────────────────────────

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  defaultCategoryId: text('default_category_id').references(() => categories.id),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  nameIdx: index('idx_payees_name').on(t.name),
}));

// ─────────────────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────────────────

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  date: text('date').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payeeId: text('payee_id').references(() => payees.id),
  notes: text('notes'),

  cleared: integer('cleared', { mode: 'boolean' }).notNull().default(false),
  reconciled: integer('reconciled', { mode: 'boolean' }).notNull().default(false),

  transferId: text('transfer_id'),
  scheduleId: text('schedule_id'),
  ...timestamps,
}, (t) => ({
  accountDateIdx: index('idx_transactions_account_date').on(t.accountId, t.date),
  dateIdx: index('idx_transactions_date').on(t.date),
  payeeIdx: index('idx_transactions_payee').on(t.payeeId),
}));

// ─────────────────────────────────────────────────────────────────
// TRANSACTION SPLITS
// ─────────────────────────────────────────────────────────────────

export const transactionSplits = sqliteTable('transaction_splits', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  categoryId: text('category_id').references(() => categories.id),
  transferAccountId: text('transfer_account_id').references(() => accounts.id),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  transactionIdx: index('idx_splits_transaction').on(t.transactionId),
  categoryIdx: index('idx_splits_category').on(t.categoryId),
  transferIdx: index('idx_splits_transfer').on(t.transferAccountId),
}));

// ─────────────────────────────────────────────────────────────────
// TAGS
// ─────────────────────────────────────────────────────────────────

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const splitTags = sqliteTable('split_tags', {
  splitId: text('split_id').notNull().references(() => transactionSplits.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.splitId, t.tagId] }),
  tagIdx: index('idx_split_tags_tag').on(t.tagId),
}));

// ─────────────────────────────────────────────────────────────────
// BUDGETS
// ─────────────────────────────────────────────────────────────────

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  month: text('month').notNull(),
  categoryId: text('category_id').notNull().references(() => categories.id),
  assignedCents: integer('assigned_cents').notNull().default(0),
  carryoverOverride: integer('carryover_override', { mode: 'boolean' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  monthIdx: index('idx_budgets_month').on(t.month),
}));

// ─────────────────────────────────────────────────────────────────
// SCHEDULES
// ─────────────────────────────────────────────────────────────────

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  payeeId: text('payee_id').references(() => payees.id),
  categoryId: text('category_id').references(() => categories.id),
  transferAccountId: text('transfer_account_id').references(() => accounts.id),
  amountCents: integer('amount_cents').notNull(),
  rrule: text('rrule').notNull(),
  nextOccurrence: text('next_occurrence').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  autoPost: integer('auto_post', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  nextIdx: index('idx_schedules_next').on(t.nextOccurrence),
}));

// ─────────────────────────────────────────────────────────────────
// BALANCE SNAPSHOTS
// ─────────────────────────────────────────────────────────────────

export const balanceSnapshots = sqliteTable('balance_snapshots', {
  accountId: text('account_id').notNull().references(() => accounts.id),
  date: text('date').notNull(),
  balanceCents: integer('balance_cents').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.accountId, t.date] }),
  dateIdx: index('idx_snapshots_date').on(t.date),
}));

// ─────────────────────────────────────────────────────────────────
// PURCHASE LOG
// ─────────────────────────────────────────────────────────────────

export const purchaseLog = sqliteTable('purchase_log', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  itemName: text('item_name').notNull(),
  amountCents: integer('amount_cents').notNull(),
  quantity: real('quantity'),
  unit: text('unit'),
  store: text('store'),
  notes: text('notes'),
  transactionId: text('transaction_id').references(() => transactions.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  itemIdx: index('idx_purchase_log_item').on(t.itemName, t.date),
  dateIdx: index('idx_purchase_log_date').on(t.date),
}));

// ─────────────────────────────────────────────────────────────────
// RULES
// ─────────────────────────────────────────────────────────────────

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  name: text('name'),
  matchPayeeId: text('match_payee_id').references(() => payees.id),
  matchPayeeText: text('match_payee_text'),
  matchAmountCents: integer('match_amount_cents'),
  matchAccountId: text('match_account_id').references(() => accounts.id),
  setCategoryId: text('set_category_id').references(() => categories.id),
  setNotes: text('set_notes'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  ...timestamps,
});

// ═══════════════════════════════════════════════════════════════════
// Type exports — derived from schema, used throughout the app
// ═══════════════════════════════════════════════════════════════════

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type CategoryGroup = typeof categoryGroups.$inferSelect;
export type NewCategoryGroup = typeof categoryGroups.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Payee = typeof payees.$inferSelect;
export type NewPayee = typeof payees.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type NewTransactionSplit = typeof transactionSplits.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type PurchaseLogEntry = typeof purchaseLog.$inferSelect;
export type NewPurchaseLogEntry = typeof purchaseLog.$inferInsert;
export type Rule = typeof rules.$inferSelect;
