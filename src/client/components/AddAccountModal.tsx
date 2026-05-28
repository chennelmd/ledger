import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

// ─── constants ───────────────────────────────────────────────────────────────

const SUBTYPES = {
  asset:     ['checking', 'savings', 'cash', 'investment'],
  liability: ['credit_card', 'heloc', 'mortgage', 'student_loan', 'tax_debt', 'auto_loan', 'personal_loan', 'retirement_loan'],
  tracking:  ['home_value', 'car_value', 'other_asset'],
} as const;

const SUBTYPE_LABEL: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash', investment: 'Investment',
  credit_card: 'Credit Card', heloc: 'HELOC', mortgage: 'Mortgage',
  student_loan: 'Student Loan', tax_debt: 'Tax Debt', auto_loan: 'Auto Loan',
  personal_loan: 'Personal Loan', retirement_loan: 'Retirement Loan',
  home_value: 'Home Value', car_value: 'Car Value', other_asset: 'Other Asset',
};

type AccountType = keyof typeof SUBTYPES;

// ─── api ─────────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; }
interface CategoryGroup { id: string; name: string; isIncome: boolean; categories: Category[]; }

async function fetchCategories(): Promise<CategoryGroup[]> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('failed to fetch categories');
  return res.json();
}

async function saveAccount(id: string | undefined, payload: Record<string, unknown>) {
  const res = await fetch(id ? `/api/accounts/${id}` : '/api/accounts', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Request failed');
  }
  return res.json();
}

// ─── styles ──────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(28, 25, 23, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 24,
  },
  modal: {
    background: '#FFFEF9',
    border: '1px solid #E7DFD0',
    width: '100%',
    maxWidth: 480,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: '24px 28px 0',
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 22,
    fontWeight: 500,
    letterSpacing: '-0.02em',
    color: '#1C1917',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#78716C',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
  },
  body: { padding: '20px 28px 28px' },
  fieldset: { border: 'none', padding: 0, margin: 0 },
  row: { marginBottom: 16 },
  label: {
    display: 'block',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#78716C',
    marginBottom: 5,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '8px 10px',
    fontSize: 13.5,
    color: '#1C1917',
    outline: 'none',
    fontFamily: 'inherit',
  },
  moneyInput: {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums',
  },
  select: {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '8px 10px',
    fontSize: 13.5,
    color: '#1C1917',
    appearance: 'auto' as const,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  sectionHeading: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#78716C',
    margin: '20px 0 14px',
    paddingTop: 16,
    borderTop: '1px solid #F0EADD',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  checkLabel: {
    fontSize: 13.5,
    color: '#1C1917',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 20,
    borderTop: '1px solid #F0EADD',
    marginTop: 8,
  },
  btnCancel: {
    background: 'none',
    border: '1px solid #E7DFD0',
    padding: '8px 20px',
    fontSize: 13,
    color: '#78716C',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnSubmit: {
    background: '#1C1917',
    border: 'none',
    padding: '8px 20px',
    fontSize: 13,
    color: '#FBF8F1',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  errorMsg: {
    marginTop: 10,
    fontSize: 12.5,
    color: '#7A1F2B',
  },
};

// ─── component ───────────────────────────────────────────────────────────────

interface Account {
  id: string; name: string; type: string; subtype: string;
  isOnBudget: boolean; startingBalanceCents: number;
  debtCategoryId?: string | null;
  isRevolving?: boolean | null; creditLimitCents?: number | null;
  rateType?: string | null;
  apr?: number | null; standardApr?: number | null;
  promoEndDate?: string | null;
  minPaymentCents?: number | null;
  statementDay?: number | null; dueDay?: number | null;
}

interface Props {
  onClose: () => void;
  account?: Account;
}

export function AddAccountModal({ onClose, account }: Props) {
  const qc = useQueryClient();
  const isEditing = !!account;

  const [name, setName]         = useState(account?.name ?? '');
  const [type, setType]         = useState<AccountType>((account?.type as AccountType) ?? 'asset');
  const [subtype, setSubtype]   = useState<string>(account?.subtype ?? 'checking');
  const [balance, setBalance]   = useState(
    account ? (Math.abs(account.startingBalanceCents) / 100).toFixed(2) : ''
  );
  const [isOnBudget, setIsOnBudget] = useState(account?.isOnBudget ?? true);

  // liability-only fields — convert stored values back to form strings
  const [isRevolving, setIsRevolving] = useState(
    account?.isRevolving == null ? '' : account.isRevolving ? 'true' : 'false'
  );
  const [creditLimit, setCreditLimit] = useState(
    account?.creditLimitCents ? (account.creditLimitCents / 100).toFixed(2) : ''
  );
  const [rateType, setRateType] = useState(account?.rateType ?? 'fixed');
  const [apr, setApr] = useState(
    account?.apr ? (account.apr * 100).toFixed(2) : ''
  );
  const [standardApr, setStandardApr] = useState(
    account?.standardApr ? (account.standardApr * 100).toFixed(2) : ''
  );
  const [promoEndDate, setPromoEndDate] = useState(account?.promoEndDate ?? '');
  const [minPayment, setMinPayment] = useState(
    account?.minPaymentCents ? (account.minPaymentCents / 100).toFixed(2) : ''
  );
  const [statementDay, setStatementDay] = useState(
    account?.statementDay ? String(account.statementDay) : ''
  );
  const [dueDay, setDueDay] = useState(
    account?.dueDay ? String(account.dueDay) : ''
  );
  const [debtCategoryId, setDebtCategoryId] = useState(account?.debtCategoryId ?? '');

  const { data: categoryGroups } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    enabled: type === 'liability',
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => saveAccount(account?.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      onClose();
    },
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleTypeChange(t: AccountType) {
    setType(t);
    setSubtype(SUBTYPES[t][0]);
    setIsOnBudget(t !== 'tracking');
    setDebtCategoryId('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Always take absolute value so entering -3750 or 3750 for a liability both work
    const rawCents = Math.abs(Math.round(parseFloat(balance || '0') * 100));
    // Liabilities are debts — store as negative so balance math works uniformly
    const startingBalanceCents = type === 'liability' ? -rawCents : rawCents;
    const payload: Record<string, unknown> = {
      name: name.trim(),
      type,
      subtype,
      isOnBudget,
      startingBalanceCents,
      // When editing, only send null (clear intent) if the user explicitly removed a
      // previously-linked category. Sending null unconditionally wipes the link even
      // when the user didn't touch the Debt Category field.
      linkedDebtCategoryId: isEditing
        ? (type === 'liability' && isOnBudget
            ? (debtCategoryId || (account?.debtCategoryId ? null : undefined))
            : undefined)
        : (type === 'liability' && isOnBudget ? debtCategoryId || null : null),
    };

    if (type === 'liability') {
      if (debtCategoryId) payload.startingBalanceCategoryId = debtCategoryId;
      if (isRevolving !== '') payload.isRevolving = isRevolving === 'true';
      if (creditLimit)   payload.creditLimitCents  = Math.round(parseFloat(creditLimit) * 100);
      payload.rateType = rateType;
      payload.apr = apr ? parseFloat(apr) / 100 : null; // store as decimal: 24.99 → 0.2499
      if (rateType === 'promotional') {
        payload.standardApr  = standardApr ? parseFloat(standardApr) / 100 : null; // store as decimal: 24.99 → 0.2499
        payload.promoEndDate = promoEndDate || null;
      } else {
        // Explicitly null out promo-only fields so switching away from promotional clears them in the DB
        payload.standardApr  = null;
        payload.promoEndDate = null;
      }
      if (minPayment)    payload.minPaymentCents    = Math.round(parseFloat(minPayment) * 100);
      if (statementDay)  payload.statementDay       = parseInt(statementDay, 10);
      if (dueDay)        payload.dueDay             = parseInt(dueDay, 10);
    }

    mutation.mutate(payload);
  }

  return (
    <div style={S.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>
        <div style={S.header}>
          <h2 style={S.title}>{isEditing ? 'Edit Account' : 'New Account'}</h2>
          <button style={S.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={S.body}>
          <form onSubmit={handleSubmit}>
            <fieldset style={S.fieldset} disabled={mutation.isPending}>

              {/* Name */}
              <div style={S.row}>
                <label style={S.label} htmlFor="acc-name">Account Name</label>
                <input
                  id="acc-name"
                  style={S.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. AMHFCU Checking"
                  required
                  autoFocus
                />
              </div>

              {/* Type + Subtype */}
              <div style={{ ...S.row, ...S.grid2 }}>
                <div>
                  <label style={S.label} htmlFor="acc-type">Type</label>
                  <select
                    id="acc-type"
                    style={S.select}
                    value={type}
                    onChange={(e) => handleTypeChange(e.target.value as AccountType)}
                  >
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="tracking">Tracking</option>
                  </select>
                </div>
                <div>
                  <label style={S.label} htmlFor="acc-subtype">Subtype</label>
                  <select
                    id="acc-subtype"
                    style={S.select}
                    value={subtype}
                    onChange={(e) => setSubtype(e.target.value)}
                  >
                    {SUBTYPES[type].map((st) => (
                      <option key={st} value={st}>{SUBTYPE_LABEL[st]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Starting Balance */}
              <div style={S.row}>
                <label style={S.label} htmlFor="acc-balance">Starting Balance</label>
                <input
                  id="acc-balance"
                  style={{ ...S.input, ...S.moneyInput }}
                  type="number"
                  step="0.01"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              {/* On Budget */}
              <div style={S.checkRow}>
                <input
                  id="acc-onbudget"
                  type="checkbox"
                  checked={isOnBudget}
                  onChange={(e) => setIsOnBudget(e.target.checked)}
                />
                <label htmlFor="acc-onbudget" style={S.checkLabel}>On budget</label>
              </div>

              {/* Liability fields */}
              {type === 'liability' && (
                <>
                  <div style={S.sectionHeading}>Debt Details</div>

                  {/* Debt category — used for on-budget liability planning */}
                  {isOnBudget && (
                    <div style={S.row}>
                      <label style={S.label} htmlFor="acc-debtcat">
                        Debt Category
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
                          (for debt planning)
                        </span>
                      </label>
                      <select
                        id="acc-debtcat"
                        style={S.select}
                        value={debtCategoryId}
                        onChange={(e) => setDebtCategoryId(e.target.value)}
                      >
                        <option value="">
                          {isEditing ? 'None' : `Auto-create: Bank Card Debt – ${name.trim() || 'Account Name'}`}
                        </option>
                        {categoryGroups?.filter((g) => !g.isIncome).map((g) => (
                          <optgroup key={g.id} label={g.name}>
                            {g.categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Revolving */}
                  <div style={S.row}>
                    <label style={S.label} htmlFor="acc-revolving">Revolving?</label>
                    <select
                      id="acc-revolving"
                      style={S.select}
                      value={isRevolving}
                      onChange={(e) => setIsRevolving(e.target.value)}
                    >
                      <option value="">— select —</option>
                      <option value="true">Yes (credit card, HELOC)</option>
                      <option value="false">No (installment loan)</option>
                    </select>
                  </div>

                  <div style={S.row}>
                    <label style={S.label} htmlFor="acc-limit">Credit Limit</label>
                    <input
                      id="acc-limit"
                      style={{ ...S.input, ...S.moneyInput }}
                      type="number"
                      step="0.01"
                      min="0"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>

                  <div style={S.row}>
                    <label style={S.label} htmlFor="acc-ratetype">Rate Type</label>
                    <select
                      id="acc-ratetype"
                      style={S.select}
                      value={rateType}
                      onChange={(e) => setRateType(e.target.value)}
                    >
                      <option value="fixed">Fixed</option>
                      <option value="variable">Variable</option>
                      <option value="promotional">Promotional</option>
                    </select>
                  </div>

                  {rateType === 'promotional' ? (
                    <>
                      <div style={{ ...S.row, ...S.grid2 }}>
                        <div>
                          <label style={S.label} htmlFor="acc-apr">Promo APR (%)</label>
                          <input
                            id="acc-apr"
                            style={{ ...S.input, ...S.moneyInput }}
                            type="number"
                            step="0.01"
                            min="0"
                            value={apr}
                            onChange={(e) => setApr(e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label style={S.label} htmlFor="acc-standardapr">Standard APR (%)</label>
                          <input
                            id="acc-standardapr"
                            style={{ ...S.input, ...S.moneyInput }}
                            type="number"
                            step="0.01"
                            min="0"
                            value={standardApr}
                            onChange={(e) => setStandardApr(e.target.value)}
                            placeholder="24.99"
                          />
                        </div>
                      </div>
                      <div style={S.row}>
                        <label style={S.label} htmlFor="acc-promoend">Promo End Date</label>
                        <input
                          id="acc-promoend"
                          style={S.input}
                          type="date"
                          value={promoEndDate}
                          onChange={(e) => setPromoEndDate(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div style={S.row}>
                      <label style={S.label} htmlFor="acc-apr">APR (%)</label>
                      <input
                        id="acc-apr"
                        style={{ ...S.input, ...S.moneyInput }}
                        type="number"
                        step="0.01"
                        min="0"
                        value={apr}
                        onChange={(e) => setApr(e.target.value)}
                        placeholder="24.99"
                      />
                    </div>
                  )}

                  <div style={{ ...S.row, ...S.grid2 }}>
                    <div>
                      <label style={S.label} htmlFor="acc-minpay">Min Payment</label>
                      <input
                        id="acc-minpay"
                        style={{ ...S.input, ...S.moneyInput }}
                        type="number"
                        step="0.01"
                        min="0"
                        value={minPayment}
                        onChange={(e) => setMinPayment(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      {/* spacer */}
                    </div>
                  </div>

                  <div style={{ ...S.row, ...S.grid2 }}>
                    <div>
                      <label style={S.label} htmlFor="acc-stmtday">Statement Day</label>
                      <input
                        id="acc-stmtday"
                        style={S.input}
                        type="number"
                        min="1"
                        max="31"
                        value={statementDay}
                        onChange={(e) => setStatementDay(e.target.value)}
                        placeholder="1–31"
                      />
                    </div>
                    <div>
                      <label style={S.label} htmlFor="acc-dueday">Due Day</label>
                      <input
                        id="acc-dueday"
                        style={S.input}
                        type="number"
                        min="1"
                        max="31"
                        value={dueDay}
                        onChange={(e) => setDueDay(e.target.value)}
                        placeholder="1–31"
                      />
                    </div>
                  </div>
                </>
              )}

              {mutation.isError && (
                <p style={S.errorMsg}>
                  {(mutation.error as Error).message}
                </p>
              )}

              <div style={S.footer}>
                <button type="button" style={S.btnCancel} onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" style={S.btnSubmit}>
                  {mutation.isPending
                    ? (isEditing ? 'Saving…' : 'Adding…')
                    : (isEditing ? 'Save Changes' : 'Add Account')}
                </button>
              </div>

            </fieldset>
          </form>
        </div>
      </div>
    </div>
  );
}
