import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Send, SkipForward, Trash2 } from 'lucide-react';
import type { Account } from '../../db/schema.js';
import { AddTransactionModal } from '../components/AddTransactionModal.js';

// ─── types ────────────────────────────────────────────────────────────────────

interface TxnRow {
  id: string;
  accountId: string;
  accountName: string | null;
  date: string;
  amountCents: number;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferId: string | null;
  transferAccountName: string | null;
  notes: string | null;
  cleared: boolean;
  splitAmountCents: number | null;
  splitNotes: string | null;
}

interface CategoryItem { id: string; name: string; }
interface CategoryGroup { id: string; name: string; categories: CategoryItem[]; }
type AccountRow = Account & { balanceCents: number };

interface ScheduleRow {
  id: string;
  name: string;
  accountId: string;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  nextOccurrence: string;
  isActive: boolean;
  notes: string | null;
}

interface EditForm {
  date: string;
  payeeName: string;
  notes: string;
  splits: Array<{ categoryId: string; amount: string; notes: string }>;
  amount: string; // used for transfer edits only
  accountId: string;
  amountType?: 'expense' | 'income';
}

// ─── api ─────────────────────────────────────────────────────────────────────

async function fetchAccounts(): Promise<AccountRow[]> {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('failed to fetch accounts');
  return res.json();
}

async function fetchTransactions(accountId: string): Promise<TxnRow[]> {
  const url = accountId ? `/api/transactions?accountId=${accountId}` : '/api/transactions';
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to fetch transactions');
  return res.json();
}

async function fetchCategories(): Promise<CategoryGroup[]> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('failed to fetch categories');
  return res.json();
}

async function fetchSchedules(): Promise<ScheduleRow[]> {
  const res = await fetch('/api/schedules?days=7');
  if (!res.ok) throw new Error('failed to fetch schedules');
  return res.json();
}

async function patchTransaction(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('failed to update');
  return res.json();
}

async function deleteTransaction(id: string) {
  const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('failed to delete');
  return res.json();
}

async function patchTransfer(transferId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/transactions/transfer/${transferId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('failed to update transfer');
  return res.json();
}

async function postScheduleOccurrence(id: string) {
  const res = await fetch(`/api/schedules/${id}/post`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'failed to post schedule');
  }
  return res.json();
}

async function skipScheduleOccurrence(id: string) {
  const res = await fetch(`/api/schedules/${id}/skip`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'failed to skip schedule');
  }
  return res.json();
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const todayIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const SPLIT_OPTION = '__split_transaction__';

// ─── styles ──────────────────────────────────────────────────────────────────

const S = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  select: {
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '7px 10px',
    fontSize: 13,
    color: '#1C1917',
    fontFamily: 'inherit',
    cursor: 'pointer',
    minWidth: 180,
  },
  addBtn: {
    background: '#1C1917',
    border: 'none',
    color: '#FBF8F1',
    padding: '9px 18px',
    fontSize: 12.5,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
  },
  th: {
    padding: '8px 14px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: '#78716C',
    textAlign: 'left' as const,
    borderBottom: '1px solid #E7DFD0',
    background: '#F5EFE6',
  },
  thRight: { textAlign: 'right' as const },
  td: {
    padding: '11px 14px',
    fontSize: 13.5,
    color: '#1C1917',
    borderBottom: '1px solid #F0EADD',
    verticalAlign: 'middle' as const,
  },
  tdMuted: { color: '#A8A29E', fontStyle: 'italic' as const },
  tdMono: {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right' as const,
  },
  amtPositive: { color: '#2D5016' },
  amtNegative: { color: '#1C1917' },
  clearedCheck: { cursor: 'pointer', accentColor: '#1C1917' },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#C5BDB5',
    padding: 3,
    display: 'inline-flex',
    alignItems: 'center',
  },
  iconBtnDanger: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#C5BDB5',
    padding: 3,
    display: 'inline-flex',
    alignItems: 'center',
  },
  scheduleAction: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#A8A29E',
    padding: 3,
    display: 'inline-flex',
    alignItems: 'center',
  },
  upcomingBadge: {
    display: 'inline-block',
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.04em',
    color: '#6D28D9',
    background: '#F1E8FF',
    padding: '2px 6px',
  },
  pastDueBadge: {
    color: '#7A1F2B',
    background: '#F7E6E8',
  },
  dueTodayBadge: {
    color: '#795300',
    background: '#FFF3CC',
  },
  scheduleRow: {
    background: '#F7F2EA',
    opacity: 0.72,
  },
  saveBtn: {
    background: '#1C1917',
    border: 'none',
    color: '#FBF8F1',
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid #E7DFD0',
    color: '#78716C',
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cellInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #D6CFC6',
    background: '#FFFEF9',
    padding: '4px 7px',
    fontSize: 13,
    color: '#1C1917',
    fontFamily: 'inherit',
    outline: 'none',
  },
  cellSelect: {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #D6CFC6',
    background: '#FFFEF9',
    padding: '4px 7px',
    fontSize: 13,
    color: '#1C1917',
    fontFamily: 'inherit',
  },
  signedAmount: {
    display: 'grid',
    gridTemplateColumns: '26px minmax(0, 1fr)',
    gap: 6,
    alignItems: 'center',
  },
  signBtn: {
    border: '1px solid #D6CFC6',
    background: '#F5EFE6',
    color: '#78716C',
    height: 27,
    width: 26,
    padding: 0,
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    lineHeight: 1,
  },
  signBtnIncome: {
    color: '#2D5016',
    background: '#F3F7ED',
    borderColor: '#C8D8B8',
  },
  editRow: { background: '#FEFAF4' },
  empty: {
    padding: 48,
    textAlign: 'center' as const,
    color: '#78716C',
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
  },
};

// ─── component ───────────────────────────────────────────────────────────────

export function LedgerPage({ initialAccountId = '' }: { initialAccountId?: string }) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(initialAccountId);
  const [showAdd, setShowAdd]     = useState(false);
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editForm, setEditForm]           = useState<EditForm | null>(null);
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());

  function toggleSplit(id: string) {
    setExpandedSplits(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const { data: accounts }  = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const { data: groups }    = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const { data: schedules } = useQuery({ queryKey: ['schedules', 7], queryFn: fetchSchedules });
  const { data: txns, isLoading, error } = useQuery({
    queryKey: ['transactions', accountId],
    queryFn: () => fetchTransactions(accountId),
  });

  const toggleCleared = useMutation({
    mutationFn: ({ id, cleared }: { id: string; cleared: boolean }) =>
      patchTransaction(id, { cleared }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body, isTransfer }: { id: string; body: Record<string, unknown>; isTransfer: boolean }) =>
      isTransfer ? patchTransfer(id, body) : patchTransaction(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setEditingId(null);
      setEditForm(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const postScheduleMutation = useMutation({
    mutationFn: postScheduleOccurrence,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
    },
  });

  const skipScheduleMutation = useMutation({
    mutationFn: skipScheduleOccurrence,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  // Escape cancels the active edit
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditingId(null); setEditForm(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  function startEdit(t: TxnRow) {
    setEditingId(t.id);
    if (t.transferId) {
      setEditForm({
        date: t.date,
        payeeName: '',
        notes: t.notes ?? '',
        splits: [],
        amount: (Math.abs(t.amountCents) / 100).toFixed(2),
        accountId: t.accountId,
      });
    } else {
      const allSplitRows = txns!.filter(r => r.id === t.id);
      const editSign = t.amountCents < 0 || (t.amountCents === 0 && (t.splitAmountCents ?? 0) < 0) ? -1 : 1;
      const splits = allSplitRows.map(r => ({
        categoryId: r.categoryId ?? '',
        amount: (Math.abs(r.splitAmountCents ?? r.amountCents) / 100).toFixed(2),
        notes: r.splitNotes ?? '',
      }));
      setEditForm({
        date: t.date,
        payeeName: t.payeeName ?? '',
        notes: t.notes ?? '',
        splits,
        amount: '',
        accountId: t.accountId,
        amountType: editSign >= 0 ? 'income' : 'expense',
      });
    }
  }

  function saveEdit(t: TxnRow) {
    if (!editForm) return;
    if (t.transferId) {
      const body: Record<string, unknown> = {
        date: editForm.date,
        amountCents: Math.round(parseFloat(editForm.amount) * 100),
        notes: editForm.notes.trim() || null,
      };
      editMutation.mutate({ id: t.transferId, body, isTransfer: true });
    } else {
      const wasSplit = (txns?.filter(r => r.id === t.id).length ?? 0) > 1;
      const sign = editForm.amountType === 'income' ? 1 : -1;
      const parsedSplits = editForm.splits
        .map(s => ({
          amountCents: sign * Math.round(Math.abs(parseFloat(s.amount || '0')) * 100),
          categoryId: s.categoryId || null,
          notes: s.notes.trim() || null,
        }))
        .filter(s => s.amountCents !== 0 || s.categoryId);
      const totalCents = parsedSplits.reduce((sum, s) => sum + s.amountCents, 0);
      if (parsedSplits.length === 0) return;
      const body: Record<string, unknown> = {
        date: editForm.date,
        amountCents: totalCents,
        accountId: editForm.accountId,
        notes: editForm.notes.trim() || null,
      };
      if (editForm.payeeName.trim()) body.payeeName = editForm.payeeName.trim();
      if (parsedSplits.length > 1 || wasSplit || parsedSplits.some(s => s.notes)) {
        body.splits = parsedSplits;
      } else {
        body.categoryId = parsedSplits[0]?.categoryId ?? null;
      }
      editMutation.mutate({ id: t.id, body, isTransfer: false });
    }
  }

  function handleDelete(id: string) {
    if (window.confirm('Delete this transaction?')) deleteMutation.mutate(id);
  }

  const visibleSchedules = (schedules ?? []).filter((schedule) =>
    schedule.isActive && (!accountId || schedule.accountId === accountId)
  );
  const hasLedgerRows = (txns?.length ?? 0) > 0 || visibleSchedules.length > 0;

  return (
    <>
      {showAdd && (
        <AddTransactionModal
          onClose={() => setShowAdd(false)}
          defaultAccountId={accountId || undefined}
        />
      )}

      <div style={S.toolbar}>
        <select
          style={S.select}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">All accounts</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <button style={S.addBtn} onClick={() => setShowAdd(true)}>
          + New Transaction
        </button>
      </div>

      {isLoading && <p style={{ color: '#78716C' }}>Loading…</p>}
      {error && <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>}

      {txns && !hasLedgerRows && (
        <div style={S.empty}>No transactions yet.</div>
      )}

      {txns && hasLedgerRows && (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Date</th>
              <th style={S.th}>Account</th>
              <th style={S.th}>Payee</th>
              <th style={S.th}>Notes</th>
              <th style={S.th}>Category</th>
              <th style={{ ...S.th, ...S.thRight }}>Amount</th>
              <th style={{ ...S.th, ...S.thRight }}>Balance</th>
              <th style={{ ...S.th, textAlign: 'center' }}>✓</th>
              <th style={{ ...S.th, width: 64 }}></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Group rows by transaction id (preserving date-desc order of first appearance).
              // Each group is one logical transaction; multi-split groups have >1 row.
              const groupMap = new Map<string, TxnRow[]>();
              for (const t of txns) {
                if (!groupMap.has(t.id)) groupMap.set(t.id, []);
                groupMap.get(t.id)!.push(t);
              }

              const runningBalanceByAccount = new Map(
                (accounts ?? []).map((account) => [account.id, account.balanceCents]),
              );
              const futureTotalsByAccount = new Map<string, number>();
              for (const schedule of visibleSchedules) {
                futureTotalsByAccount.set(
                  schedule.accountId,
                  (futureTotalsByAccount.get(schedule.accountId) ?? 0) + schedule.amountCents,
                );
              }
              for (const [futureAccountId, futureTotal] of futureTotalsByAccount) {
                const currentBalance = runningBalanceByAccount.get(futureAccountId);
                if (currentBalance !== undefined) {
                  runningBalanceByAccount.set(futureAccountId, currentBalance + futureTotal);
                }
              }
              const monoInput = { ...S.cellInput, textAlign: 'right' as const, fontFamily: "'JetBrains Mono', monospace" };
              const catSelect = (
                value: string,
                onChange: (v: string) => void,
                onSplit?: () => void,
              ) => (
                <select
                  style={S.cellSelect}
                  value={value}
                  onChange={(e) => {
                    if (e.target.value === SPLIT_OPTION) {
                      onSplit?.();
                      return;
                    }
                    onChange(e.target.value);
                  }}
                >
                  <option value="">— none —</option>
                  {onSplit && <option value={SPLIT_OPTION}>Split transaction</option>}
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
              );

              const ledgerItems = [
                ...visibleSchedules.map((schedule) => ({
                  type: 'schedule' as const,
                  id: schedule.id,
                  date: schedule.nextOccurrence,
                  schedule,
                })),
                ...[...groupMap.values()].map((rows) => ({
                  type: 'transaction' as const,
                  id: rows[0].id,
                  date: rows[0].date,
                  rows,
                })),
              ].sort((a, b) => {
                if (a.type !== b.type) return a.type === 'schedule' ? -1 : 1;
                const dateCompare = b.date.localeCompare(a.date);
                if (dateCompare !== 0) return dateCompare;
                return a.id.localeCompare(b.id);
              });

              return ledgerItems.flatMap((item) => {
                if (item.type === 'schedule') {
                  const schedule = item.schedule;
                  const balanceAfterCents = runningBalanceByAccount.get(schedule.accountId);
                  if (balanceAfterCents !== undefined) {
                    runningBalanceByAccount.set(schedule.accountId, balanceAfterCents - schedule.amountCents);
                  }
                  const currentDate = todayIso();
                  const scheduleStatus =
                    schedule.nextOccurrence < currentDate
                      ? 'Past due'
                      : schedule.nextOccurrence === currentDate
                        ? 'Due today'
                        : 'Upcoming';
                  const scheduleBadgeStyle = {
                    ...S.upcomingBadge,
                    ...(scheduleStatus === 'Past due' ? S.pastDueBadge : {}),
                    ...(scheduleStatus === 'Due today' ? S.dueTodayBadge : {}),
                  };

                  return [(
                    <tr key={`schedule|${schedule.id}`} style={S.scheduleRow}>
                      <td style={{ ...S.td, fontStyle: 'italic', color: '#78716C' }}>{fmtDate(schedule.nextOccurrence)}</td>
                      <td style={{ ...S.td, color: '#78716C', fontSize: 12.5 }}>{schedule.accountName ?? '—'}</td>
                      <td style={{ ...S.td, color: '#78716C', fontStyle: 'italic' }}>
                        {schedule.name}
                      </td>
                      <td style={{ ...S.td, color: schedule.notes ? '#78716C' : '#A8A29E', fontSize: 12.5, fontStyle: 'italic' }}>
                        {schedule.notes ?? schedule.categoryName ?? '—'}
                      </td>
                      <td style={S.td}>
                        <span style={scheduleBadgeStyle}>{scheduleStatus}</span>
                      </td>
                      <td style={{
                        ...S.td,
                        ...S.tdMono,
                        color: '#78716C',
                        fontStyle: 'italic',
                      }}>
                        {fmt$(schedule.amountCents)}
                      </td>
                      <td style={{ ...S.td, ...S.tdMono, color: '#78716C', fontStyle: 'italic' }}>
                        {!accountId || balanceAfterCents === undefined ? '—' : fmt$(balanceAfterCents)}
                      </td>
                      <td style={{ ...S.td, textAlign: 'center', color: '#A8A29E' }}>—</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap', padding: '11px 8px' }}>
                        <button
                          style={S.scheduleAction}
                          onClick={() => postScheduleMutation.mutate(schedule.id)}
                          disabled={postScheduleMutation.isPending || skipScheduleMutation.isPending}
                          aria-label={`Post ${schedule.name}`}
                          title="Post scheduled transaction"
                        >
                          <Send size={13} />
                        </button>
                        <button
                          style={S.scheduleAction}
                          onClick={() => skipScheduleMutation.mutate(schedule.id)}
                          disabled={postScheduleMutation.isPending || skipScheduleMutation.isPending}
                          aria-label={`Skip ${schedule.name}`}
                          title="Skip this occurrence"
                        >
                          <SkipForward size={13} />
                        </button>
                      </td>
                    </tr>
                  )];
                }

                const rows = item.rows;
                const first = rows[0];
                const isEditing = editingId === first.id;
                const isTransfer = !!first.transferAccountName;
                const isMultiSplit = rows.length > 1;
                const balanceAfterCents = runningBalanceByAccount.get(first.accountId);
                if (balanceAfterCents !== undefined) {
                  runningBalanceByAccount.set(first.accountId, balanceAfterCents - first.amountCents);
                }

                // ── Edit mode ──────────────────────────────────────────────────
                if (isEditing && editForm) {
                  const elems: React.ReactElement[] = [];
                  const editIsSplit = !isTransfer && editForm.splits.length > 1;
                  const editAmountType = editForm.amountType ?? 'expense';
                  const editSign = editAmountType === 'income' ? 1 : -1;
                  const editTotalCents = editSign * editForm.splits.reduce(
                    (sum, split) => sum + Math.round(Math.abs(parseFloat(split.amount || '0')) * 100),
                    0,
                  );
                  const signToggle = (
                    <button
                      type="button"
                      style={{
                        ...S.signBtn,
                        ...(editAmountType === 'income' ? S.signBtnIncome : {}),
                      }}
                      onClick={() => setEditForm({
                        ...editForm,
                        amountType: editAmountType === 'income' ? 'expense' : 'income',
                      })}
                      aria-label={editAmountType === 'income' ? 'Mark as payment' : 'Mark as deposit'}
                      aria-pressed={editAmountType === 'income'}
                      title={editAmountType === 'income' ? 'Deposit/refund' : 'Payment'}
                    >
                      {editAmountType === 'income' ? '+' : '-'}
                    </button>
                  );

                  // Primary edit row
                  const split0 = editForm.splits[0];
                  elems.push(
                    <tr key={`${first.id}|edit|summary`} style={S.editRow}>
                      <td style={S.td}>
                        <input
                          style={S.cellInput}
                          type="date"
                          value={editForm.date}
                          onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                        />
                      </td>
                      <td style={S.td}>
                        {isTransfer ? (
                          <span style={{ color: '#78716C', fontSize: 12.5 }}>{first.accountName ?? '—'}</span>
                        ) : (
                          <select
                            style={S.cellSelect}
                            value={editForm.accountId}
                            onChange={(e) => setEditForm({ ...editForm, accountId: e.target.value })}
                          >
                            {accounts?.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td style={S.td}>
                        {isTransfer ? (
                          <span style={{ color: '#78716C' }}>Transfer: {first.transferAccountName}</span>
                        ) : (
                          <input
                            style={S.cellInput}
                            type="text"
                            value={editForm.payeeName}
                            onChange={(e) => setEditForm({ ...editForm, payeeName: e.target.value })}
                            placeholder="Payee"
                          />
                        )}
                      </td>
                      <td style={S.td}>
                        <input
                          style={S.cellInput}
                          type="text"
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          placeholder="Notes"
                        />
                      </td>
                      <td style={S.td}>
                        {isTransfer ? (
                          <span style={S.tdMuted}>—</span>
                        ) : editIsSplit ? (
                          <span style={{
                            display: 'inline-block',
                            fontSize: 10.5,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: '#78716C',
                            background: '#EDE8DF',
                            padding: '2px 6px',
                          }}>Split</span>
                        ) : (
                          <div>
                            {catSelect(split0?.categoryId ?? '', (v) => {
                              const next = editForm.splits.map((s, i) => i === 0 ? { ...s, categoryId: v } : s);
                              setEditForm({ ...editForm, splits: next });
                            }, () => {
                              setEditForm({
                                ...editForm,
                                splits: [...editForm.splits, { categoryId: '', amount: '', notes: '' }],
                              });
                            })}
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, ...S.tdMono }}>
                        {isTransfer ? (
                          <input
                            style={monoInput}
                            type="number"
                            step="0.01"
                            value={editForm.amount}
                            onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(first); }}
                          />
                        ) : editIsSplit ? (
                          <div style={S.signedAmount}>
                            {signToggle}
                            <span style={editTotalCents >= 0 ? S.amtPositive : S.amtNegative}>
                              {fmt$(editTotalCents)}
                            </span>
                          </div>
                        ) : (
                          <div style={S.signedAmount}>
                            {signToggle}
                            <input
                              style={monoInput}
                              type="number"
                              step="0.01"
                              value={split0?.amount ?? ''}
                              onChange={(e) => {
                                const next = editForm.splits.map((s, i) => i === 0 ? { ...s, amount: e.target.value } : s);
                                setEditForm({ ...editForm, splits: next });
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(first); }}
                            />
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, ...S.tdMono, color: '#A8A29E' }}>—</td>
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          style={S.clearedCheck}
                          checked={first.cleared}
                          onChange={() => toggleCleared.mutate({ id: first.id, cleared: !first.cleared })}
                        />
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button style={S.saveBtn} onClick={() => saveEdit(first)} disabled={editMutation.isPending}>
                          Save
                        </button>{' '}
                        <button style={S.cancelBtn} onClick={() => { setEditingId(null); setEditForm(null); }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );

                  // Split edit rows mirror saved split rows.
                  for (let i = editIsSplit ? 0 : 1; i < editForm.splits.length; i++) {
                    const idx = i;
                    const splitEntry = editForm.splits[idx];
                    elems.push(
                      <tr key={`${first.id}|edit|${idx}`} style={S.editRow}>
                        <td style={{ ...S.td, color: '#C5BDB5' }}>—</td>
                        <td style={{ ...S.td, color: '#C5BDB5' }}>—</td>
                        <td style={{ ...S.td, color: '#C5BDB5' }}>—</td>
                        <td style={S.td}>
                          <input
                            style={S.cellInput}
                            type="text"
                            value={splitEntry?.notes ?? ''}
                            onChange={(e) => {
                              const next = editForm.splits.map((s, j) => j === idx ? { ...s, notes: e.target.value } : s);
                              setEditForm({ ...editForm, splits: next });
                            }}
                            placeholder="Split note"
                          />
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px', gap: 6, alignItems: 'center' }}>
                            {catSelect(splitEntry?.categoryId ?? '', (v) => {
                              const next = editForm.splits.map((s, j) => j === idx ? { ...s, categoryId: v } : s);
                              setEditForm({ ...editForm, splits: next });
                            }, () => {
                              setEditForm({
                                ...editForm,
                                splits: [...editForm.splits, { categoryId: '', amount: '', notes: '' }],
                              });
                            })}
                            <button
                              type="button"
                              style={S.iconBtnDanger}
                              onClick={() => setEditForm({
                                ...editForm,
                                splits: editForm.splits.filter((_, j) => j !== idx),
                              })}
                              aria-label="Remove split"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                        <td style={{ ...S.td, ...S.tdMono }}>
                          <input
                            style={monoInput}
                            type="number"
                            step="0.01"
                            value={splitEntry?.amount ?? ''}
                            onChange={(e) => {
                              const next = editForm.splits.map((s, j) => j === idx ? { ...s, amount: e.target.value } : s);
                              setEditForm({ ...editForm, splits: next });
                            }}
                          />
                        </td>
                        <td style={S.td} /><td style={S.td} /><td style={S.td} />
                      </tr>
                    );
                  }

                  return elems;
                }

                // ── Display mode ───────────────────────────────────────────────
                if (isMultiSplit) {
                  const elems: React.ReactElement[] = [];

                  const collapsed = !expandedSplits.has(first.id);

                  // Header row: chevron + SPLIT badge + total
                  elems.push(
                    <tr key={first.id}>
                      <td style={S.td}>{fmtDate(first.date)}</td>
                      <td style={{ ...S.td, color: '#78716C', fontSize: 12.5 }}>{first.accountName ?? '—'}</td>
                      <td style={S.td}>
                        {first.payeeName ?? <span style={S.tdMuted}>—</span>}
                      </td>
                      <td style={{ ...S.td, color: first.notes ? '#78716C' : '#A8A29E', fontSize: 12.5 }}>
                        {first.notes ?? '—'}
                      </td>
                      <td style={S.td}>
                        <button
                          onClick={() => toggleSplit(first.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            marginRight: 5,
                            color: '#78716C',
                            display: 'inline-flex',
                            verticalAlign: 'middle',
                          }}
                          aria-label={collapsed ? 'Expand splits' : 'Collapse splits'}
                        >
                          {collapsed
                            ? <ChevronRight size={12} />
                            : <ChevronDown size={12} />}
                        </button>
                        <span style={{
                          display: 'inline-block',
                          fontSize: 10.5,
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: '#78716C',
                          background: '#EDE8DF',
                          padding: '2px 6px',
                          verticalAlign: 'middle',
                        }}>Split</span>
                      </td>
                      <td style={{
                        ...S.td, ...S.tdMono,
                        ...(first.amountCents >= 0 ? S.amtPositive : S.amtNegative),
                      }}>
                        {fmt$(first.amountCents)}
                      </td>
                      <td style={{ ...S.td, ...S.tdMono, color: '#78716C' }}>
                        {!accountId || balanceAfterCents === undefined ? '—' : fmt$(balanceAfterCents)}
                      </td>
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          style={S.clearedCheck}
                          checked={first.cleared}
                          onChange={() => toggleCleared.mutate({ id: first.id, cleared: !first.cleared })}
                        />
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap', padding: '11px 8px' }}>
                        <button style={S.iconBtn} onClick={() => startEdit(first)} aria-label="Edit">
                          <Pencil size={13} />
                        </button>
                        <button style={S.iconBtnDanger} onClick={() => handleDelete(first.id)} aria-label="Delete">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );

                  // One sub-row per split — hidden when collapsed
                  if (!collapsed) for (const row of rows) {
                    elems.push(
                      <tr key={`${row.id}|${row.categoryId ?? ''}`} style={{ background: '#FEFAF4' }}>
                        <td style={{ ...S.td, color: '#C5BDB5' }}>—</td>
                        <td style={{ ...S.td, color: '#C5BDB5' }}>—</td>
                        <td style={{ ...S.td, color: '#C5BDB5' }}>—</td>
                        <td style={{ ...S.td, color: row.splitNotes ? '#A8A29E' : '#C5BDB5', fontSize: 11.5 }}>
                          {row.splitNotes ?? '—'}
                        </td>
                        <td style={S.td}>
                          <span style={{ color: '#78716C', fontSize: 12.5 }}>
                            {row.categoryName ?? <em style={{ color: '#A8A29E' }}>Uncategorized</em>}
                          </span>
                        </td>
                        <td style={{ ...S.td, ...S.tdMono, color: '#78716C', fontSize: 12.5 }}>
                          {fmt$(row.splitAmountCents ?? 0)}
                        </td>
                        <td style={S.td} /><td style={S.td} /><td style={S.td} />
                      </tr>
                    );
                  }

                  return elems;
                }

                // Regular single-split or transfer row
                const displayCents = first.splitAmountCents ?? first.amountCents;
                return [(
                  <tr key={first.id}>
                    <td style={S.td}>{fmtDate(first.date)}</td>
                    <td style={{ ...S.td, color: '#78716C', fontSize: 12.5 }}>{first.accountName ?? '—'}</td>
                    <td style={S.td}>
                      {isTransfer
                        ? <span style={{ color: '#78716C' }}>Transfer: {first.transferAccountName}</span>
                        : first.payeeName ?? <span style={S.tdMuted}>—</span>}
                    </td>
                    <td style={{ ...S.td, color: first.notes ? '#78716C' : '#A8A29E', fontSize: 12.5 }}>
                      {first.notes ?? '—'}
                    </td>
                    <td style={S.td}>
                      {isTransfer
                        ? <span style={S.tdMuted}>—</span>
                        : first.categoryName ?? <span style={S.tdMuted}>—</span>}
                    </td>
                    <td style={{
                      ...S.td, ...S.tdMono,
                      ...(displayCents >= 0 ? S.amtPositive : S.amtNegative),
                    }}>
                      {fmt$(displayCents)}
                    </td>
                    <td style={{ ...S.td, ...S.tdMono, color: '#78716C' }}>
                      {!accountId || balanceAfterCents === undefined ? '—' : fmt$(balanceAfterCents)}
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        style={S.clearedCheck}
                        checked={first.cleared}
                        onChange={() => toggleCleared.mutate({ id: first.id, cleared: !first.cleared })}
                      />
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap', padding: '11px 8px' }}>
                      <button style={S.iconBtn} onClick={() => startEdit(first)} aria-label="Edit">
                        <Pencil size={13} />
                      </button>
                      <button style={S.iconBtnDanger} onClick={() => handleDelete(first.id)} aria-label="Delete">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )];
              });
            })()}
          </tbody>
        </table>
      )}
    </>
  );
}
