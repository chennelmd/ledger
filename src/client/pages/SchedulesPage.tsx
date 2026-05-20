import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Send, SkipForward, Trash2 } from 'lucide-react';
import type { Account } from '../../db/schema.js';

type Category = { id: string; name: string };
type CategoryGroup = { id: string; name: string; isIncome: boolean; categories: Category[] };

type Schedule = {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  rrule: string;
  nextOccurrence: string;
  isActive: boolean;
  autoPost: boolean;
  notes: string | null;
  upcomingOccurrences: string[];
};

type EditScheduleForm = {
  name: string;
  accountId: string;
  categoryId: string;
  amount: string;
  nextOccurrence: string;
  frequency: string;
  notes: string;
  isActive: boolean;
};

async function fetchSchedules(): Promise<Schedule[]> {
  const res = await fetch('/api/schedules');
  if (!res.ok) throw new Error('failed to fetch schedules');
  return res.json();
}

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

async function postSchedule(payload: Record<string, unknown>) {
  const res = await fetch('/api/schedules', {
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

async function patchSchedule(id: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('failed to update schedule');
  return res.json();
}

async function deleteSchedule(id: string) {
  const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('failed to delete schedule');
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

const today = () => new Date().toISOString().slice(0, 10);

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function dateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function daysUntil(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - today.getTime()) / msPerDay);
}

function dueLabel(date: string) {
  const days = daysUntil(date);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

function rruleFor(startDate: string, frequency: string) {
  const dtstart = startDate.replaceAll('-', '');
  const [freq, interval] = frequency.split(':');
  return `DTSTART:${dtstart}T000000Z\nRRULE:FREQ=${freq};INTERVAL=${interval}`;
}

function frequencyFromRrule(rrule: string) {
  const freq = rrule.match(/FREQ=([^;\n]+)/)?.[1] ?? 'MONTHLY';
  const interval = rrule.match(/INTERVAL=([^;\n]+)/)?.[1] ?? '1';
  return `${freq}:${interval}`;
}

const S = {
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 20,
    marginBottom: 24,
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    color: '#78716C',
    fontWeight: 600,
  },
  h2: {
    fontFamily: "'Fraunces', serif",
    fontSize: 24,
    fontWeight: 500,
    margin: '4px 0 0',
    color: '#1C1917',
  },
  panel: {
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
    padding: 18,
    marginBottom: 28,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12,
  },
  label: {
    display: 'block',
    fontSize: 10,
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
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    marginTop: 14,
  },
  submit: {
    background: '#1C1917',
    border: 'none',
    padding: '9px 18px',
    fontSize: 12.5,
    color: '#FBF8F1',
    cursor: 'pointer',
    fontFamily: 'inherit',
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
  cancelBtn: {
    background: 'none',
    border: '1px solid #E7DFD0',
    padding: '8px 18px',
    fontSize: 12.5,
    color: '#78716C',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  table: {
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) 130px 130px 120px 250px',
    gap: 14,
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid #F0EADD',
  },
  editPanel: {
    padding: 16,
    borderBottom: '1px solid #F0EADD',
    background: '#FEFAF4',
  },
  name: {
    fontSize: 13.5,
    fontWeight: 600,
    color: '#1C1917',
  },
  meta: {
    fontSize: 11.5,
    color: '#78716C',
    marginTop: 3,
  },
  mono: {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums' as const,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#A8A29E',
    padding: 4,
  },
  postBtn: {
    background: '#1C1917',
    border: 'none',
    color: '#FBF8F1',
    padding: '6px 10px',
    fontSize: 11.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  skipBtn: {
    background: '#F5EFE6',
    border: '1px solid #E7DFD0',
    color: '#78716C',
    padding: '5px 9px',
    fontSize: 11.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  empty: {
    padding: 32,
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
    color: '#78716C',
  },
};

export function SchedulesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [frequency, setFrequency] = useState('MONTHLY:1');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditScheduleForm | null>(null);

  const { data: schedules, isLoading, error } = useQuery({
    queryKey: ['schedules', 'all'],
    queryFn: fetchSchedules,
  });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const { data: groups } = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });

  const expenseGroups = groups?.filter((group) => !group.isIncome) ?? [];

  const createMutation = useMutation({
    mutationFn: postSchedule,
    onSuccess: () => {
      setName('');
      setAmount('');
      setNotes('');
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      patchSchedule(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSchedule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const postMutation = useMutation({
    mutationFn: postScheduleOccurrence,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
    },
  });

  const skipMutation = useMutation({
    mutationFn: skipScheduleOccurrence,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  function startEdit(schedule: Schedule) {
    setEditingId(schedule.id);
    setEditForm({
      name: schedule.name,
      accountId: schedule.accountId,
      categoryId: schedule.categoryId ?? '',
      amount: (Math.abs(schedule.amountCents) / 100).toFixed(2),
      nextOccurrence: schedule.nextOccurrence,
      frequency: frequencyFromRrule(schedule.rrule),
      notes: schedule.notes ?? '',
      isActive: schedule.isActive,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  function saveEdit(id: string) {
    if (!editForm) return;
    const cents = Math.round(Math.abs(parseFloat(editForm.amount || '0')) * 100);
    updateMutation.mutate({
      id,
      payload: {
        name: editForm.name.trim(),
        accountId: editForm.accountId,
        categoryId: editForm.categoryId,
        amountCents: -cents,
        rrule: rruleFor(editForm.nextOccurrence, editForm.frequency),
        nextOccurrence: editForm.nextOccurrence,
        notes: editForm.notes.trim() || null,
        isActive: editForm.isActive,
      },
    }, {
      onSuccess: cancelEdit,
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(Math.abs(parseFloat(amount || '0')) * 100);
    createMutation.mutate({
      name: name.trim(),
      accountId,
      categoryId,
      amountCents: -cents,
      rrule: rruleFor(startDate, frequency),
      nextOccurrence: startDate,
      notes: notes.trim() || null,
    });
  }

  return (
    <div>
      <div style={S.topBar}>
        <div>
          <div style={S.eyebrow}>Vol. 1 · Runway</div>
          <h2 style={S.h2}>Schedules</h2>
        </div>
        {!showAdd && (
          <button style={S.addBtn} onClick={() => setShowAdd(true)}>
            + Schedule
          </button>
        )}
      </div>

      {showAdd && (
        <form style={S.panel} onSubmit={handleSubmit}>
          <div style={S.grid}>
            <div>
              <label style={S.label} htmlFor="schedule-name">Name</label>
              <input
                id="schedule-name"
                style={S.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mortgage, internet"
                required
                autoFocus
              />
            </div>
            <div>
              <label style={S.label} htmlFor="schedule-account">Account</label>
              <select
                id="schedule-account"
                style={S.select}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">Select</option>
                {accounts?.filter((account) => account.isOnBudget).map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={S.label} htmlFor="schedule-amount">Amount</label>
              <input
                id="schedule-amount"
                style={{ ...S.input, ...S.mono }}
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label style={S.label} htmlFor="schedule-frequency">Repeats</label>
              <select
                id="schedule-frequency"
                style={S.select}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="WEEKLY:1">Weekly</option>
                <option value="WEEKLY:2">Every 2 weeks</option>
                <option value="MONTHLY:1">Monthly</option>
                <option value="YEARLY:1">Yearly</option>
              </select>
            </div>
          </div>

          <div style={{ ...S.grid, marginTop: 12 }}>
            <div>
              <label style={S.label} htmlFor="schedule-start">Next date</label>
              <input
                id="schedule-start"
                style={S.input}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={S.label} htmlFor="schedule-category">Category</label>
              <select
                id="schedule-category"
                style={S.select}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
              >
                <option value="">Select</option>
                {expenseGroups.map((group) => (
                  <optgroup key={group.id} label={group.name}>
                    {group.categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label style={S.label} htmlFor="schedule-notes">Notes</label>
              <input
                id="schedule-notes"
                style={S.input}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <button style={S.submit} type="submit" disabled={createMutation.isPending}>
                Add
              </button>
              <button style={S.cancelBtn} type="button" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
            </div>
          </div>
          <div style={S.footer}>
            <span style={{ color: '#78716C', fontSize: 12.5 }}>
              Upcoming scheduled outflows feed the Free Cash calculation for the next 30 days.
            </span>
            {createMutation.error && (
              <span style={{ color: '#7A1F2B', fontSize: 12.5 }}>
                {(createMutation.error as Error).message}
              </span>
            )}
          </div>
        </form>
      )}

      {isLoading && <p style={{ color: '#78716C' }}>Loading...</p>}
      {error && <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>}
      {schedules && schedules.length === 0 && <div style={S.empty}>No schedules yet.</div>}

      {schedules && schedules.length > 0 && (
        <div style={S.table}>
          {schedules.map((schedule, idx) => {
            const isEditing = editingId === schedule.id && editForm;
            if (isEditing) {
              return (
                <div
                  key={schedule.id}
                  style={{
                    ...S.editPanel,
                    borderBottom: idx === schedules.length - 1 ? 'none' : S.row.borderBottom,
                  }}
                >
                  <div style={S.grid}>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-name-${schedule.id}`}>Name</label>
                      <input
                        id={`edit-schedule-name-${schedule.id}`}
                        style={S.input}
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-account-${schedule.id}`}>Account</label>
                      <select
                        id={`edit-schedule-account-${schedule.id}`}
                        style={S.select}
                        value={editForm.accountId}
                        onChange={(e) => setEditForm({ ...editForm, accountId: e.target.value })}
                      >
                        {accounts?.filter((account) => account.isOnBudget).map((account) => (
                          <option key={account.id} value={account.id}>{account.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-amount-${schedule.id}`}>Amount</label>
                      <input
                        id={`edit-schedule-amount-${schedule.id}`}
                        style={{ ...S.input, ...S.mono }}
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={editForm.amount}
                        onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-frequency-${schedule.id}`}>Repeats</label>
                      <select
                        id={`edit-schedule-frequency-${schedule.id}`}
                        style={S.select}
                        value={editForm.frequency}
                        onChange={(e) => setEditForm({ ...editForm, frequency: e.target.value })}
                      >
                        <option value="WEEKLY:1">Weekly</option>
                        <option value="WEEKLY:2">Every 2 weeks</option>
                        <option value="MONTHLY:1">Monthly</option>
                        <option value="YEARLY:1">Yearly</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ ...S.grid, marginTop: 12 }}>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-next-${schedule.id}`}>Next date</label>
                      <input
                        id={`edit-schedule-next-${schedule.id}`}
                        style={S.input}
                        type="date"
                        value={editForm.nextOccurrence}
                        onChange={(e) => setEditForm({ ...editForm, nextOccurrence: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-category-${schedule.id}`}>Category</label>
                      <select
                        id={`edit-schedule-category-${schedule.id}`}
                        style={S.select}
                        value={editForm.categoryId}
                        onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
                      >
                        <option value="">Select</option>
                        {expenseGroups.map((group) => (
                          <optgroup key={group.id} label={group.name}>
                            {group.categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor={`edit-schedule-notes-${schedule.id}`}>Notes</label>
                      <input
                        id={`edit-schedule-notes-${schedule.id}`}
                        style={S.input}
                        value={editForm.notes}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 8 }}>
                      <label style={{ ...S.meta, display: 'flex', gap: 6, alignItems: 'center', marginRight: 'auto' }}>
                        <input
                          type="checkbox"
                          checked={editForm.isActive}
                          onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                        />
                        Active
                      </label>
                      <button
                        style={S.submit}
                        type="button"
                        onClick={() => saveEdit(schedule.id)}
                        disabled={updateMutation.isPending || !editForm.name.trim() || !editForm.accountId || !editForm.categoryId}
                      >
                        Save
                      </button>
                      <button style={S.cancelBtn} type="button" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={schedule.id}
                style={{
                  ...S.row,
                  borderBottom: idx === schedules.length - 1 ? 'none' : S.row.borderBottom,
                  opacity: schedule.isActive ? 1 : 0.55,
                }}
              >
                <div>
                  <div style={S.name}>{schedule.name}</div>
                  <div style={S.meta}>
                    {schedule.accountName}
                    {schedule.categoryName ? ` · ${schedule.categoryName}` : ''}
                  </div>
                </div>
                <div style={S.mono}>{fmt$(schedule.amountCents)}</div>
                <div>
                  <div style={S.meta}>Next</div>
                  <div style={S.name}>{dateLabel(schedule.nextOccurrence)}</div>
                </div>
                <div>
                  <div style={S.meta}>Due in</div>
                  <div style={S.name}>{dueLabel(schedule.nextOccurrence)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    style={{ ...S.postBtn, opacity: postMutation.isPending ? 0.55 : 1 }}
                    onClick={() => postMutation.mutate(schedule.id)}
                    disabled={postMutation.isPending || skipMutation.isPending || !schedule.isActive}
                    aria-label={`Post ${schedule.name}`}
                    title={`Post ${schedule.name} on ${schedule.nextOccurrence}`}
                  >
                    <Send size={13} />
                    Post
                  </button>
                  <button
                    style={{ ...S.skipBtn, opacity: skipMutation.isPending ? 0.55 : 1 }}
                    onClick={() => skipMutation.mutate(schedule.id)}
                    disabled={postMutation.isPending || skipMutation.isPending || !schedule.isActive}
                    aria-label={`Skip ${schedule.name}`}
                    title={`Skip ${schedule.name} on ${schedule.nextOccurrence}`}
                  >
                    <SkipForward size={13} />
                    Skip
                  </button>
                  <label style={{ ...S.meta, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={schedule.isActive}
                      onChange={(e) => updateMutation.mutate({
                        id: schedule.id,
                        payload: { isActive: e.target.checked },
                      })}
                    />
                    Active
                  </label>
                  <button
                    style={S.iconBtn}
                    onClick={() => startEdit(schedule)}
                    aria-label={`Edit ${schedule.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    style={S.iconBtn}
                    onClick={() => deleteMutation.mutate(schedule.id)}
                    aria-label={`Delete ${schedule.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          {postMutation.error && (
            <div style={{ padding: '10px 16px', color: '#7A1F2B', fontSize: 12.5 }}>
              {(postMutation.error as Error).message}
            </div>
          )}
          {skipMutation.error && (
            <div style={{ padding: '10px 16px', color: '#7A1F2B', fontSize: 12.5 }}>
              {(skipMutation.error as Error).message}
            </div>
          )}
          {updateMutation.error && (
            <div style={{ padding: '10px 16px', color: '#7A1F2B', fontSize: 12.5 }}>
              {(updateMutation.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
