import { Fragment, useEffect, useRef, useState } from 'react';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ─── types ────────────────────────────────────────────────────────────────────

interface BudgetCategory {
  id: string;
  name: string;
  isIncome: boolean;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
}

interface BudgetGroup {
  id: string;
  name: string;
  isIncome: boolean;
  categories: BudgetCategory[];
}

interface BudgetMonth {
  month: string;
  readyToAssignCents: number;
  groups: BudgetGroup[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function monthRangeLabel(months: string[]) {
  if (months.length === 1) return monthLabel(months[0]);
  return `${shortMonthLabel(months[0])} – ${shortMonthLabel(months[months.length - 1])}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── api ─────────────────────────────────────────────────────────────────────

async function fetchBudget(month: string): Promise<BudgetMonth> {
  const res = await fetch(`/api/budget/${month}`);
  if (!res.ok) throw new Error('failed to fetch budget');
  return res.json();
}

async function putAssignment(month: string, categoryId: string, assignedCents: number) {
  const res = await fetch(`/api/budget/${month}/${categoryId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedCents }),
  });
  if (!res.ok) throw new Error('failed to save');
  return res.json();
}

async function postGroup(name: string) {
  const res = await fetch('/api/categories/groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('failed to create group');
  return res.json();
}

async function patchGroup(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/categories/groups/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('failed to update group');
  return res.json();
}

async function postCategory(groupId: string, name: string) {
  const res = await fetch('/api/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, name }),
  });
  if (!res.ok) throw new Error('failed to create category');
  return res.json();
}

async function patchCategory(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/categories/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('failed to update category');
  return res.json();
}

// ─── column widths ────────────────────────────────────────────────────────────

function minMoneyColWidth(numMonths: number) {
  return numMonths === 1 ? 112 : numMonths === 2 ? 96 : 78;
}

function categoryColumnWidth(data?: BudgetMonth) {
  const labels = data?.groups.flatMap((group) => [
    group.name,
    ...group.categories.map((category) => category.name),
    'Total',
  ]) ?? ['Total'];
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  return Math.min(Math.max(Math.ceil(longest * 7.5) + 28, 96), 220);
}

function gridTemplate(numMonths: number, categoryWidth: number) {
  const w = minMoneyColWidth(numMonths);
  return `${categoryWidth}px ${Array(3 * numMonths).fill(`minmax(${w}px, 1fr)`).join(' ')}`;
}

function readStoredNumMonths(): 1 | 2 | 3 {
  if (typeof window === 'undefined') return 1;
  const stored = Number(window.localStorage.getItem('budget:numMonths'));
  return stored === 2 || stored === 3 ? stored : 1;
}

// Vertical separator between month groups
const MONTH_SEP: React.CSSProperties = { borderLeft: '1px solid #D6CFC6' };

// ─── styles ──────────────────────────────────────────────────────────────────

const S = {
  topBar: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 24, gap: 16,
  },
  monthNav: { display: 'flex', alignItems: 'center', gap: 10 },
  monthLabel: {
    fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 500,
    letterSpacing: '-0.01em', color: '#1C1917',
    minWidth: 150, textAlign: 'center' as const,
  },
  navBtn: {
    background: 'none', border: '1px solid #E7DFD0', cursor: 'pointer',
    padding: '4px 6px', display: 'flex', alignItems: 'center', color: '#78716C',
  },
  toggleGroup: { display: 'flex', gap: 2 },
  toggleBtn: (active: boolean): React.CSSProperties => ({
    background: active ? '#1C1917' : 'none',
    border: `1px solid ${active ? '#1C1917' : '#E7DFD0'}`,
    color: active ? '#FBF8F1' : '#78716C',
    width: 28, height: 28, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }),
  readyBox: (pos: boolean): React.CSSProperties => ({
    padding: '8px 16px', whiteSpace: 'nowrap',
    background: pos ? '#F0F4EC' : '#FAF0F0',
    border: `1px solid ${pos ? '#C5D5B5' : '#E5C5C5'}`,
    display: 'flex', alignItems: 'baseline', gap: 10,
  }),
  readyLabel: {
    fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
    textTransform: 'uppercase' as const, color: '#78716C',
  },
  readyAmount: (pos: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums',
    fontSize: 16, fontWeight: 600, color: pos ? '#2D5016' : '#7A1F2B',
  }),
  // Group header
  groupBlock: { marginBottom: 24 },
  groupGridWrap: { overflowX: 'visible' as const, paddingBottom: 2 },
  groupHeaderWrap: { borderBottom: '1px solid #1C1917' },
  groupNameArea: {
    display: 'flex', flexDirection: 'column' as const,
    justifyContent: 'center', gap: 5, padding: '6px 0',
  },
  groupNameText: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em',
    textTransform: 'uppercase' as const, color: '#1C1917', cursor: 'text' as const,
  },
  groupNameInput: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em',
    textTransform: 'uppercase' as const, color: '#1C1917',
    border: '1px solid #1C1917', background: '#FFFEF9',
    padding: '1px 5px', outline: 'none', fontFamily: 'inherit', width: 160,
  },
  monthLabelCell: {
    textAlign: 'center' as const, fontSize: 10, fontWeight: 700,
    letterSpacing: '0.14em', textTransform: 'uppercase' as const,
    color: '#78716C', padding: '6px 0 3px',
  },
  colHead: {
    fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em',
    textTransform: 'uppercase' as const, color: '#A8A29E',
    textAlign: 'right' as const, paddingRight: 10, paddingBottom: 5,
    alignSelf: 'center' as const,
  },
  // Category rows
  catName: {
    padding: '10px 12px', fontSize: 13.5, color: '#1C1917', cursor: 'text' as const,
  },
  catNameInput: {
    fontSize: 13.5, color: '#1C1917', border: '1px solid #D6CFC6',
    background: '#FFFEF9', padding: '4px 7px', outline: 'none',
    fontFamily: 'inherit', margin: '6px 8px',
    width: 'calc(100% - 30px)', boxSizing: 'border-box' as const,
  },
  cellMono: {
    fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums',
    fontSize: 13, textAlign: 'right' as const, paddingRight: 10,
  },
  activityCell: { color: '#78716C' },
  availablePositive: { color: '#2D5016' },
  availableNegative: { color: '#7A1F2B', fontWeight: 600 },
  availableZero: { color: '#A8A29E' },
  // AssignedCell
  assignedBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums',
    fontSize: 13, textAlign: 'right' as const, width: '100%',
    paddingRight: 10, paddingTop: 10, paddingBottom: 10,
  },
  assignedInput: {
    border: '1px solid #1C1917', background: '#FFFEF9',
    fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums',
    fontSize: 13, textAlign: 'right' as const, width: '100%',
    padding: '6px 8px', boxSizing: 'border-box' as const, outline: 'none', color: '#1C1917',
  },
  // Add category
  addCatRow: {
    padding: '8px 12px', background: '#FBF8F1',
    borderBottom: '1px solid #F0EADD', cursor: 'pointer',
  },
  addCatForm: {
    display: 'flex', gap: 8, padding: '8px 12px',
    background: '#FBF8F1', borderBottom: '1px solid #F0EADD',
  },
  inlineInput: {
    flex: 1, border: '1px solid #E7DFD0', background: '#FFFEF9',
    padding: '5px 8px', fontSize: 13, color: '#1C1917', outline: 'none', fontFamily: 'inherit',
  },
  inlineBtn: {
    background: '#1C1917', border: 'none', color: '#FBF8F1',
    padding: '5px 12px', fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
  },
  inlineCancelBtn: {
    background: 'none', border: '1px solid #E7DFD0', color: '#78716C',
    padding: '5px 12px', fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
  },
  // Totals row
  totalsRow: {
    background: '#F5EFE6', borderTop: '1px solid #E7DFD0',
    alignItems: 'center', minHeight: 36,
  },
  // Add group
  addGroupSection: { marginTop: 8, display: 'flex', gap: 8 },
  addGroupInput: {
    flex: 1, border: '1px solid #E7DFD0', background: '#FFFEF9',
    padding: '8px 10px', fontSize: 13.5, color: '#1C1917',
    outline: 'none', fontFamily: 'inherit',
  },
  addGroupBtn: {
    background: 'none', border: '1px solid #E7DFD0', color: '#78716C',
    padding: '8px 16px', fontSize: 12.5, cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
  },
};

const availStyle = (cents: number): React.CSSProperties =>
  cents > 0 ? S.availablePositive : cents < 0 ? S.availableNegative : S.availableZero;

const budgetGridStyle = (gridCols: string): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: gridCols,
  minWidth: '100%',
  width: '100%',
});

// ─── AssignedCell ─────────────────────────────────────────────────────────────

function AssignedCell({ month, categoryId, assignedCents, isIncome }: {
  month: string; categoryId: string; assignedCents: number; isIncome: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (isIncome) {
    return <div style={{ ...S.cellMono, color: '#C5BDB5', paddingTop: 10, paddingBottom: 10 }}>—</div>;
  }

  const mutation = useMutation({
    mutationFn: (cents: number) => putAssignment(month, categoryId, cents),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget', month] }),
  });

  function startEdit() {
    setDraft(assignedCents === 0 ? '' : (assignedCents / 100).toFixed(2));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit() {
    const cents = Math.round(parseFloat(draft || '0') * 100);
    if (!isNaN(cents) && cents !== assignedCents) mutation.mutate(cents);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef} style={S.assignedInput} type="number" step="0.01" min="0"
        value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
    );
  }

  return (
    <button
      style={{ ...S.assignedBtn, color: assignedCents === 0 ? '#C5BDB5' : '#1C1917' }}
      onClick={startEdit} title="Click to edit"
    >
      {assignedCents === 0 ? '—' : fmt$(assignedCents)}
    </button>
  );
}

// ─── EditableGroupName ────────────────────────────────────────────────────────

function EditableGroupName({ group }: { group: BudgetGroup }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const mutation = useMutation({
    mutationFn: (name: string) => patchGroup(group.id, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });

  function commit() {
    const v = draft.trim();
    if (v && v !== group.name) mutation.mutate(v);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        style={S.groupNameInput} value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
    );
  }
  return (
    <span style={S.groupNameText} onClick={() => { setDraft(group.name); setEditing(true); }} title="Click to rename">
      {group.name}
    </span>
  );
}

// ─── EditableCategoryName ─────────────────────────────────────────────────────

function EditableCategoryName({ cat }: { cat: BudgetCategory }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const mutation = useMutation({
    mutationFn: (name: string) => patchCategory(cat.id, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });

  function commit() {
    const v = draft.trim();
    if (v && v !== cat.name) mutation.mutate(v);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        style={S.catNameInput} value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
    );
  }
  return (
    <div style={S.catName} onClick={() => { setDraft(cat.name); setEditing(true); }} title="Click to rename">
      {cat.name}
    </div>
  );
}

// ─── IncomeToggle ─────────────────────────────────────────────────────────────

function IncomeToggle({ group }: { group: BudgetGroup }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => patchGroup(group.id, { isIncome: !group.isIncome }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });
  return (
    <button
      onClick={() => mutation.mutate()} disabled={mutation.isPending}
      style={{
        background: group.isIncome ? '#1C1917' : 'none',
        border: '1px solid', borderColor: group.isIncome ? '#1C1917' : '#D5CCB8',
        color: group.isIncome ? '#FBF8F1' : '#A8A29E',
        fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em',
        textTransform: 'uppercase', padding: '2px 8px',
        cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start',
      }}
    >
      Income
    </button>
  );
}

// ─── AddCategoryRow ───────────────────────────────────────────────────────────

function AddCategoryRow({ groupId, month }: { groupId: string; month: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => postCategory(groupId, name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget', month] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      setName(''); setOpen(false);
    },
  });

  if (!open) {
    return (
      <div style={S.addCatRow} onClick={() => setOpen(true)}>
        <span style={{ fontSize: 12, color: '#A8A29E', letterSpacing: '0.04em' }}>+ Add category</span>
      </div>
    );
  }
  return (
    <form style={S.addCatForm} onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}>
      <input
        style={S.inlineInput} value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Category name" autoFocus
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setName(''); } }}
      />
      <button type="submit" style={S.inlineBtn} disabled={!name.trim() || mutation.isPending}>
        {mutation.isPending ? '…' : 'Add'}
      </button>
      <button type="button" style={S.inlineCancelBtn} onClick={() => { setOpen(false); setName(''); }}>
        Cancel
      </button>
    </form>
  );
}

// ─── GroupHeader ──────────────────────────────────────────────────────────────

function GroupHeader({ group, months, gridCols }: {
  group: BudgetGroup; months: string[]; gridCols: string;
}) {
  const multi = months.length > 1;

  if (!multi) {
    return (
      <div style={{ ...budgetGridStyle(gridCols), padding: '6px 0', borderBottom: '1px solid #1C1917' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EditableGroupName group={group} />
          <IncomeToggle group={group} />
        </div>
        <span style={S.colHead}>Assigned</span>
        <span style={S.colHead}>Activity</span>
        <span style={S.colHead}>Available</span>
      </div>
    );
  }

  return (
    <div style={S.groupHeaderWrap}>
      {/* Row 1: name + income | month labels (each spanning 3 cols) */}
      <div style={budgetGridStyle(gridCols)}>
        <div style={S.groupNameArea}>
          <EditableGroupName group={group} />
          <IncomeToggle group={group} />
        </div>
        {months.map((m, mi) => (
          <div
            key={m}
            style={{
              ...S.monthLabelCell,
              gridColumn: 'span 3',
              ...(mi > 0 ? MONTH_SEP : {}),
            }}
          >
            {shortMonthLabel(m)}
          </div>
        ))}
      </div>
      {/* Row 2: empty | col sub-headers per month */}
      <div style={budgetGridStyle(gridCols)}>
        <div />
        {months.map((m, mi) => (
          <Fragment key={m}>
            <span style={{ ...S.colHead, ...(mi > 0 ? MONTH_SEP : {}) }}>Assigned</span>
            <span style={S.colHead}>Activity</span>
            <span style={S.colHead}>Available</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── BudgetPage ───────────────────────────────────────────────────────────────

export function BudgetPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [numMonths, setNumMonths] = useState<1 | 2 | 3>(readStoredNumMonths);
  const [newGroupName, setNewGroupName] = useState('');

  useEffect(() => {
    window.localStorage.setItem('budget:numMonths', String(numMonths));
  }, [numMonths]);

  const months = Array.from({ length: numMonths }, (_, i) => shiftMonth(month, i));

  const budgetResults = useQueries({
    queries: months.map((m) => ({
      queryKey: ['budget', m],
      queryFn: () => fetchBudget(m),
    })),
  });

  const primaryData = budgetResults[0]?.data;
  const allData = budgetResults.map((r) => r.data);
  const isLoading = budgetResults.some((r) => r.isLoading);
  const queryError = budgetResults.find((r) => r.error)?.error;
  const ready = primaryData?.readyToAssignCents ?? 0;
  const gridCols = gridTemplate(numMonths, categoryColumnWidth(primaryData));

  function getCatMonth(catId: string, mi: number): BudgetCategory | undefined {
    return allData[mi]?.groups.flatMap((g) => g.categories).find((c) => c.id === catId);
  }

  const addGroup = useMutation({
    mutationFn: () => postGroup(newGroupName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      setNewGroupName('');
    },
  });

  return (
    <div>
      {/* Top bar */}
      <div style={S.topBar}>
        <div style={S.monthNav}>
          <button style={S.navBtn} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span style={S.monthLabel}>{monthRangeLabel(months)}</span>
          <button style={S.navBtn} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>

        <div style={S.toggleGroup}>
          {([1, 2, 3] as const).map((n) => (
            <button key={n} style={S.toggleBtn(numMonths === n)} onClick={() => setNumMonths(n)}>
              {n}
            </button>
          ))}
        </div>

        {primaryData && (
          <div style={S.readyBox(ready >= 0)}>
            <span style={S.readyLabel}>Ready to Assign</span>
            <span style={S.readyAmount(ready >= 0)}>{fmt$(ready)}</span>
          </div>
        )}
      </div>

      {isLoading && <p style={{ color: '#78716C' }}>Loading…</p>}
      {queryError && <p style={{ color: '#7A1F2B' }}>Error: {(queryError as Error).message}</p>}

      {/* Groups */}
      {primaryData?.groups.map((group) => {
        const totals = months.map((_, mi) => ({
          assigned:  group.categories.reduce((s, c) => s + (getCatMonth(c.id, mi)?.assignedCents  ?? 0), 0),
          activity:  group.categories.reduce((s, c) => s + (getCatMonth(c.id, mi)?.activityCents  ?? 0), 0),
          available: group.categories.reduce((s, c) => s + (getCatMonth(c.id, mi)?.availableCents ?? 0), 0),
        }));

        return (
          <div key={group.id} style={S.groupBlock}>
            <div style={S.groupGridWrap} data-budget-grid-wrap>
              <GroupHeader group={group} months={months} gridCols={gridCols} />

              <div style={{ border: '1px solid #E7DFD0', borderTop: 'none', minWidth: '100%', width: '100%' }}>
                {/* Category rows */}
                {group.categories.map((cat) => (
                  <div
                    key={cat.id}
                    style={{ ...budgetGridStyle(gridCols), borderBottom: '1px solid #F0EADD', background: '#FBF8F1', alignItems: 'center', minHeight: 42 }}
                    data-budget-grid-row
                  >
                    <EditableCategoryName cat={cat} />
                    {months.map((m, mi) => {
                      const d = getCatMonth(cat.id, mi);
                      const avail = d?.availableCents ?? 0;
                      return (
                        <Fragment key={m}>
                          {/* wrapper div carries the month separator border */}
                          <div style={mi > 0 ? MONTH_SEP : undefined}>
                            <AssignedCell
                              month={m} categoryId={cat.id}
                              assignedCents={d?.assignedCents ?? 0}
                              isIncome={group.isIncome}
                            />
                          </div>
                          <div style={{ ...S.cellMono, ...S.activityCell }}>
                            {(d?.activityCents ?? 0) === 0 ? '—' : fmt$(d!.activityCents)}
                          </div>
                          <div style={{ ...S.cellMono, ...availStyle(avail) }}>
                            {fmt$(avail)}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                ))}

                {/* Add category */}
                <AddCategoryRow groupId={group.id} month={month} />

                {/* Group totals */}
                {group.categories.length > 0 && (
                  <div style={{ ...budgetGridStyle(gridCols), ...S.totalsRow }}>
                    <div style={{ ...S.catName, fontSize: 11, color: '#78716C', fontWeight: 600, letterSpacing: '0.04em', cursor: 'default' }}>
                      Total
                    </div>
                    {totals.map((t, mi) => (
                      <Fragment key={months[mi]}>
                        <div style={{ ...S.cellMono, color: '#78716C', ...(mi > 0 ? MONTH_SEP : {}) }}>
                          {t.assigned === 0 ? '—' : fmt$(t.assigned)}
                        </div>
                        <div style={{ ...S.cellMono, color: '#78716C' }}>
                          {t.activity === 0 ? '—' : fmt$(t.activity)}
                        </div>
                        <div style={{ ...S.cellMono, ...availStyle(t.available) }}>
                          {fmt$(t.available)}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Add group */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#78716C', marginBottom: 8 }}>
          New Group
        </div>
        <form style={S.addGroupSection} onSubmit={(e) => { e.preventDefault(); if (newGroupName.trim()) addGroup.mutate(); }}>
          <input
            style={S.addGroupInput} value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g. Fixed Expenses"
          />
          <button type="submit" style={S.addGroupBtn} disabled={!newGroupName.trim() || addGroup.isPending}>
            {addGroup.isPending ? 'Adding…' : 'Add Group'}
          </button>
        </form>
      </div>
    </div>
  );
}
