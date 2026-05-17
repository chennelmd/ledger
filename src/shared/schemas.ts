import { z } from 'zod';

// Reusable enums matching the DB schema
export const AccountType = z.enum(['asset', 'liability', 'tracking']);
export const RateType = z.enum(['fixed', 'variable', 'promotional']);
export const GoalType = z.enum(['target_by_date', 'monthly_minimum', 'monthly_savings']);

// Canonical subtype values (free-form in DB, validated here)
export const AccountSubtype = z.enum([
  // assets
  'checking', 'savings', 'cash', 'investment',
  // liabilities
  'credit_card', 'heloc', 'mortgage', 'student_loan',
  'tax_debt', 'auto_loan', 'personal_loan', 'retirement_loan',
  // tracking
  'home_value', 'car_value', 'other_asset',
]);

export const NewAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: AccountType,
  subtype: AccountSubtype,
  isOnBudget: z.boolean().default(true),
  isClosed: z.boolean().default(false),

  startingBalanceCents: z.number().int().default(0),
  startingBalanceDate: z.string().optional(),

  isRevolving: z.boolean().nullable().optional(),
  rateType: RateType.nullable().optional(),
  apr: z.number().nullable().optional(),           // decimal fraction — see schema.ts comment
  standardApr: z.number().nullable().optional(),   // decimal fraction — see schema.ts comment
  promoEndDate: z.string().nullable().optional(),
  minPaymentCents: z.number().int().nullable().optional(),
  statementDay: z.number().int().min(1).max(31).nullable().optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
  creditLimitCents: z.number().int().nullable().optional(),

  sortOrder: z.number().int().default(0),
  notes: z.string().nullable().optional(),

  // Only used at creation time for on-budget liability accounts with non-zero starting balance.
  // The server converts the starting balance into a categorized transaction; this field names the category.
  startingBalanceCategoryId: z.string().nullable().optional(),
});

export type NewAccountInput = z.infer<typeof NewAccountSchema>;

// ─── Category Groups ─────────────────────────────────────────────────────────

export const NewCategoryGroupSchema = z.object({
  name: z.string().min(1).max(100),
  isIncome: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export type NewCategoryGroupInput = z.infer<typeof NewCategoryGroupSchema>;

// ─── Categories ───────────────────────────────────────────────────────────────

export const NewCategorySchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(100),
  isIncome: z.boolean().default(false),
  rolloverOverspending: z.boolean().default(false),
  linkedDebtAccountId: z.string().nullable().optional(),
  goalType: GoalType.nullable().optional(),
  goalAmountCents: z.number().int().nullable().optional(),
  goalDate: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
  notes: z.string().nullable().optional(),
});

export type NewCategoryInput = z.infer<typeof NewCategorySchema>;

// ─── Payees ───────────────────────────────────────────────────────────────────

export const NewPayeeSchema = z.object({
  name: z.string().min(1).max(200),
  defaultCategoryId: z.string().nullable().optional(),
  isFavorite: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

export type NewPayeeInput = z.infer<typeof NewPayeeSchema>;

// ─── Transactions ─────────────────────────────────────────────────────────────

export const SplitInputSchema = z.object({
  amountCents: z.number().int(),
  categoryId: z.string().nullable().optional(),
});

export const NewTransactionSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int(),
  payeeName: z.string().min(1).optional(),
  payeeId: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  splits: z.array(SplitInputSchema).optional(),
  notes: z.string().nullable().optional(),
  cleared: z.boolean().default(false),
});

export type NewTransactionInput = z.infer<typeof NewTransactionSchema>;

// ─── Transfers ────────────────────────────────────────────────────────────────

export const NewTransferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().positive(),
  notes: z.string().nullable().optional(),
  cleared: z.boolean().default(false),
});

export type NewTransferInput = z.infer<typeof NewTransferSchema>;

export const TransferUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountCents: z.number().int().positive().optional(),
});

export type TransferUpdateInput = z.infer<typeof TransferUpdateSchema>;

// ─── Budget ───────────────────────────────────────────────────────────────────

export const BudgetAssignmentSchema = z.object({
  assignedCents: z.number().int().min(0),
});

export type BudgetAssignmentInput = z.infer<typeof BudgetAssignmentSchema>;
