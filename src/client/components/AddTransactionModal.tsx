import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { Account } from '../../db/schema.js';

// ─── types ────────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; }
interface CategoryGroup { id: string; name: string; categories: Category[]; }
interface SplitRow { amount: string; categoryId: string; }

// ─── api ─────────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('failed to fetch accounts');
  return res.json();
}

async function fetchCategories(): Promise<CategoryGroup[]> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('failed to fetch categories');
  return res.json();
}

async function postTransaction(payload: Record<string, unknown>) {
  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Request failed');
  }
  return res.json();
}

async function postTransfer(payload: Record<string, unknown>) {
  const res = await fetch('/api/transactions/transfer', {
    method: 'POST',
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
    maxWidth: 460,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
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
  select: {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '8px 10px',
    fontSize: 13.5,
    color: '#1C1917',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  toggleGroup: {
    display: 'flex',
    border: '1px solid #E7DFD0',
    overflow: 'hidden',
  },
  toggleBtn: (active: boolean) => ({
    flex: 1,
    padding: '8px 0',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    background: active ? '#1C1917' : '#FFFEF9',
    color: active ? '#FBF8F1' : '#78716C',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }),
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  checkLabel: { fontSize: 13.5, color: '#1C1917', cursor: 'pointer' },
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
  mono: { fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' },
  errorMsg: { marginTop: 10, fontSize: 12.5, color: '#7A1F2B' },
};

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  defaultAccountId?: string;
}

export function AddTransactionModal({ onClose, defaultAccountId }: Props) {
  const qc = useQueryClient();

  const [accountId, setAccountId] = useState(defaultAccountId ?? '');
  const [date, setDate]           = useState(today());
  const [mode, setMode]           = useState<'expense' | 'income' | 'transfer'>('expense');
  const [amount, setAmount]       = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [splits, setSplits]       = useState<SplitRow[]>([{ amount: '', categoryId: '' }]);
  const [toAccountId, setToAccountId] = useState('');
  const [notes, setNotes]         = useState('');
  const [cleared, setCleared]     = useState(false);

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const { data: groups }   = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });

  // Default to first account if none pre-selected
  useEffect(() => {
    if (!accountId && accounts && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      mode === 'transfer' ? postTransfer(payload) : postTransaction(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
  });

  const totalCents = Math.round(parseFloat(amount || '0') * 100);
  const isMultiSplit = splits.length > 1;
  const allocatedCents = isMultiSplit
    ? splits.reduce((s, r) => s + Math.round(parseFloat(r.amount || '0') * 100), 0)
    : totalCents;
  const remainingCents = totalCents - allocatedCents;
  const splitsBalanced = !isMultiSplit || remainingCents === 0;

  function addSplit() {
    if (splits.length === 1) {
      // Transition to multi-split: pre-fill first row with total, add empty second row
      setSplits([
        { amount: amount, categoryId: splits[0].categoryId },
        { amount: '', categoryId: '' },
      ]);
    } else {
      setSplits([...splits, { amount: '', categoryId: '' }]);
    }
  }

  function removeSplit(i: number) {
    const next = splits.filter((_, idx) => idx !== i);
    setSplits(next.length > 0 ? next : [{ amount: '', categoryId: '' }]);
  }

  function updateSplit(i: number, field: keyof SplitRow, value: string) {
    setSplits(splits.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === 'transfer') {
      const amountCents = Math.round(parseFloat(amount || '0') * 100);
      mutation.mutate({
        fromAccountId: accountId,
        toAccountId,
        date,
        amountCents,
        notes: notes.trim() || undefined,
        cleared,
      });
      return;
    }

    const sign = mode === 'expense' ? -1 : 1;
    const amountCents = sign * totalCents;

    if (isMultiSplit) {
      mutation.mutate({
        accountId,
        date,
        amountCents,
        payeeName: payeeName.trim() || undefined,
        splits: splits.map((s) => ({
          amountCents: sign * Math.round(parseFloat(s.amount || '0') * 100),
          categoryId: s.categoryId || null,
        })),
        notes: notes.trim() || undefined,
        cleared,
      });
    } else {
      mutation.mutate({
        accountId,
        date,
        amountCents,
        payeeName: payeeName.trim() || undefined,
        categoryId: splits[0].categoryId || undefined,
        notes: notes.trim() || undefined,
        cleared,
      });
    }
  }

  return (
    <div style={S.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>
        <div style={S.header}>
          <h2 style={S.title}>New Transaction</h2>
          <button style={S.closeBtn} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div style={S.body}>
          <form onSubmit={handleSubmit}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }} disabled={mutation.isPending}>

              {/* Mode toggle */}
              <div style={S.row}>
                <div style={S.toggleGroup}>
                  <button type="button" style={S.toggleBtn(mode === 'expense')} onClick={() => setMode('expense')}>
                    Expense
                  </button>
                  <button type="button" style={S.toggleBtn(mode === 'income')} onClick={() => setMode('income')}>
                    Income
                  </button>
                  <button type="button" style={S.toggleBtn(mode === 'transfer')} onClick={() => setMode('transfer')}>
                    Transfer
                  </button>
                </div>
              </div>

              {mode === 'transfer' ? (
                <>
                  {/* From + To accounts */}
                  <div style={{ ...S.row, ...S.grid2 }}>
                    <div>
                      <label style={S.label} htmlFor="txn-from">From</label>
                      <select id="txn-from" style={S.select} value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                        {!accounts && <option value="">Loading…</option>}
                        {accounts?.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor="txn-to">To</label>
                      <select id="txn-to" style={S.select} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
                        <option value="">— select —</option>
                        {accounts?.filter((a) => a.id !== accountId).map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Amount + Date */}
                  <div style={{ ...S.row, ...S.grid2 }}>
                    <div>
                      <label style={S.label} htmlFor="txn-amount">Amount</label>
                      <input
                        id="txn-amount"
                        style={{ ...S.input, ...S.mono }}
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label style={S.label} htmlFor="txn-date">Date</label>
                      <input id="txn-date" style={S.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Account + Amount */}
                  <div style={{ ...S.row, ...S.grid2 }}>
                    <div>
                      <label style={S.label} htmlFor="txn-account">Account</label>
                      <select id="txn-account" style={S.select} value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                        {!accounts && <option value="">Loading…</option>}
                        {accounts?.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor="txn-amount">Amount</label>
                      <input
                        id="txn-amount"
                        style={{ ...S.input, ...S.mono }}
                        type="number"
                        step="0.01"
                        min="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Date */}
                  <div style={S.row}>
                    <label style={S.label} htmlFor="txn-date">Date</label>
                    <input id="txn-date" style={S.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                  </div>

                  {/* Payee */}
                  <div style={S.row}>
                    <label style={S.label} htmlFor="txn-payee">Payee</label>
                    <input
                      id="txn-payee"
                      style={S.input}
                      type="text"
                      value={payeeName}
                      onChange={(e) => setPayeeName(e.target.value)}
                      placeholder="e.g. Walmart"
                    />
                  </div>

                  {/* Category / Splits */}
                  <div style={S.row}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <span style={S.label}>Category</span>
                      <button
                        type="button"
                        onClick={addSplit}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#78716C', padding: 0, fontFamily: 'inherit', letterSpacing: '0.04em' }}
                      >
                        + Split
                      </button>
                    </div>

                    {isMultiSplit ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {splits.map((s, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 24px', gap: 6, alignItems: 'center' }}>
                            <input
                              style={{ ...S.input, ...S.mono }}
                              type="number"
                              step="0.01"
                              min="0"
                              value={s.amount}
                              onChange={(e) => updateSplit(i, 'amount', e.target.value)}
                              placeholder="0.00"
                            />
                            <select
                              style={S.select}
                              value={s.categoryId}
                              onChange={(e) => updateSplit(i, 'categoryId', e.target.value)}
                            >
                              <option value="">— none —</option>
                              {groups?.map((g) =>
                                g.categories.length > 0 ? (
                                  <optgroup key={g.id} label={g.name}>
                                    {g.categories.map((cat) => (
                                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                  </optgroup>
                                ) : null
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeSplit(i)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A8A29E', padding: 0, fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}
                              aria-label="Remove split"
                            >×</button>
                          </div>
                        ))}
                        <div style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", textAlign: 'right', marginTop: 2, color: remainingCents === 0 ? '#2D5016' : '#7A1F2B' }}>
                          {remainingCents === 0
                            ? 'balanced'
                            : `${remainingCents > 0 ? '+' : ''}${(remainingCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} remaining`}
                        </div>
                      </div>
                    ) : (
                      <select
                        id="txn-category"
                        style={S.select}
                        value={splits[0].categoryId}
                        onChange={(e) => updateSplit(0, 'categoryId', e.target.value)}
                      >
                        <option value="">— none —</option>
                        {groups?.map((g) =>
                          g.categories.length > 0 ? (
                            <optgroup key={g.id} label={g.name}>
                              {g.categories.map((cat) => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                              ))}
                            </optgroup>
                          ) : null
                        )}
                      </select>
                    )}
                  </div>
                </>
              )}

              {/* Notes */}
              <div style={S.row}>
                <label style={S.label} htmlFor="txn-notes">Notes</label>
                <input
                  id="txn-notes"
                  style={S.input}
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>

              {/* Cleared */}
              <div style={S.checkRow}>
                <input
                  id="txn-cleared"
                  type="checkbox"
                  checked={cleared}
                  onChange={(e) => setCleared(e.target.checked)}
                />
                <label htmlFor="txn-cleared" style={S.checkLabel}>Cleared</label>
              </div>

              {mutation.isError && (
                <p style={S.errorMsg}>{(mutation.error as Error).message}</p>
              )}

              <div style={S.footer}>
                <button type="button" style={S.btnCancel} onClick={onClose}>Cancel</button>
                <button
                  type="submit"
                  style={{ ...S.btnSubmit, opacity: splitsBalanced ? 1 : 0.45, cursor: splitsBalanced ? 'pointer' : 'not-allowed' }}
                  disabled={!splitsBalanced}
                >
                  {mutation.isPending ? 'Saving…' : mode === 'transfer' ? 'Add Transfer' : 'Add Transaction'}
                </button>
              </div>

            </fieldset>
          </form>
        </div>
      </div>
    </div>
  );
}
