import { Fragment, useEffect, useRef, useState } from 'react';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Target } from 'lucide-react';

// ─── types ────────────────────────────────────────────────────────────────────

interface BudgetCategory {
  id: string;
  name: string;
  isIncome: boolean;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  goalType: 'target_by_date' | 'monthly_minimum' | 'monthly_savings' | null;
  goalAmountCents: number | null;
  goalDate: string | null;
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

interface HiddenGroup { id: string; name: string; categories: { id: string; name: string }[] }

async function fetchHiddenGroups(): Promise<HiddenGroup[]> {
  const res = await fetch('/api/categories/hidden');
  if (!res.ok) throw new Error('failed to fetch hidden groups');
  return res.json();
}

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

// Copy all non-zero assignments from prevMonth into targetMonth, skipping categories
// that already have an assignment in targetMonth.
async function copyBudgetFromPrevMonth(prevMonth: string, targetMonth: string): Promise<void> {
  const [prev, curr] = await Promise.all([
    fetchBudget(prevMonth),
    fetchBudget(targetMonth),
  ]);
  const currAssigned = new Map(
    curr.groups.flatMap((g) => g.categories).map((c) => [c.id, c.assignedCents])
  );
  const toCopy = prev.groups
    .flatMap((g) => g.categories)
    .filter((c) => !c.isIncome && c.assignedCents !== 0 && (currAssigned.get(c.id) ?? 0) === 0);
  await Promise.all(
    toCopy.map((c) => putAssignment(targetMonth, c.id, c.assignedCents))
  );
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

  // Must be declared before any conditional return — React hooks must always
  // be called in the same order regardless of props.
  const mutation = useMutation({
    mutationFn: (cents: number) => putAssignment(month, categoryId, cents),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget', month] }),
  });

  if (isIncome) {
    return <div style={{ ...S.cellMono, color: '#C5BDB5', paddingTop: 10, paddingBottom: 10 }}>—</div>;
  }

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

function EditableCategoryName({ cat, currentGroupId, groups }: { cat: BudgetCategory; currentGroupId: string; groups: BudgetGroup[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => patchCategory(cat.id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });

  function commit() {
    const v = draft.trim();
    if (v && v !== cat.name) mutation.mutate({ name: v });
    setEditing(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

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

  const otherGroups = groups.filter(g => g.id !== currentGroupId);

  return (
    <div
      style={{ ...S.catName, display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span onClick={() => { setDraft(cat.name); setEditing(true); }} title="Click to rename" style={{ cursor: 'text', flex: 1 }}>
        {cat.name}
      </span>
      {otherGroups.length > 0 && (
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            title="Move to group"
            style={{
              opacity: hovered || menuOpen ? 1 : 0,
              transition: 'opacity 0.1s',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '2px 4px', borderRadius: 3, color: '#A8A29E',
              fontSize: 11, fontFamily: 'inherit', lineHeight: 1,
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 50,
              background: 'white', border: '1px solid #E7DFD0', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 160, padding: '4px 0',
            }}>
              <div style={{ fontSize: 10, color: '#A8A29E', padding: '4px 12px 2px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Move to
              </div>
              {otherGroups.map(g => (
                <button
                  key={g.id}
                  onClick={() => { mutation.mutate({ groupId: g.id }); setMenuOpen(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 12px', fontSize: 13, color: '#1C1917',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F4EFE6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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

// ─── Goal helpers ────────────────────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
  target_by_date: 'Target by date',
  monthly_minimum: 'Monthly minimum',
  monthly_savings: 'Monthly savings',
};

function goalRatio(cat: BudgetCategory): number | null {
  if (!cat.goalType || !cat.goalAmountCents || cat.goalAmountCents <= 0) return null;
  if (cat.goalType === 'target_by_date') return cat.availableCents / cat.goalAmountCents;
  // monthly_minimum / monthly_savings: track how much has been assigned this month
  return cat.assignedCents / cat.goalAmountCents;
}

// ─── GoalProgressBar ─────────────────────────────────────────────────────────
// Thin colored bar shown below the Available amount in the primary month column.
// Clicking opens the goal editor.

function GoalProgressBar({ cat, onEdit }: { cat: BudgetCategory; onEdit: () => void }) {
  const ratio = goalRatio(cat);

  if (!cat.goalType) {
    return (
      <button
        onClick={onEdit}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 10, color: '#C5BDB5', letterSpacing: '0.06em',
          textAlign: 'right', width: '100%', padding: '2px 0 0',
          fontFamily: 'inherit',
        }}
        title="Set a goal for this category"
      >
        + goal
      </button>
    );
  }

  const pct    = Math.min(100, Math.max(0, (ratio ?? 0) * 100));
  const barColor = pct >= 100 ? '#365142' : pct >= 75 ? '#856404' : '#7A1F2B';
  const label  = cat.goalType === 'target_by_date'
    ? `${Math.round(pct)}% of ${fmt$(cat.goalAmountCents!)}`
    : `${fmt$(cat.assignedCents)} of ${fmt$(cat.goalAmountCents!)}/mo`;

  return (
    <div
      onClick={onEdit}
      title={`${GOAL_LABELS[cat.goalType]} · ${label} · click to edit`}
      style={{ cursor: 'pointer', paddingTop: 4 }}
    >
      <div style={{ background: '#EDE7DC', height: 3, borderRadius: 2 }}>
        <div style={{ background: barColor, height: 3, borderRadius: 2, width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── GoalModal ────────────────────────────────────────────────────────────────

function GoalModal({ cat, onClose }: { cat: BudgetCategory; onClose: () => void }) {
  const qc = useQueryClient();
  const [goalType, setGoalType] = useState(cat.goalType ?? '');
  const [amount, setAmount]     = useState(cat.goalAmountCents ? (cat.goalAmountCents / 100).toFixed(2) : '');
  const [date, setDate]         = useState(cat.goalDate ?? '');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => patchCategory(cat.id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); onClose(); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({
      goalType: goalType || null,
      goalAmountCents: amount ? Math.round(parseFloat(amount) * 100) : null,
      goalDate: goalType === 'target_by_date' ? date || null : null,
    });
  }

  function handleClear() {
    mutation.mutate({ goalType: null, goalAmountCents: null, goalDate: null });
  }

  const MS: Record<string, React.CSSProperties> = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, padding: 24,
    },
    modal: {
      background: '#FFFEF9', border: '1px solid #E7DFD0',
      width: '100%', maxWidth: 360,
    },
    header: {
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '20px 24px 0',
    },
    title: {
      fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 500,
      letterSpacing: '-0.02em', color: '#1C1917', margin: 0,
    },
    body:  { padding: '16px 24px 24px' },
    label: {
      display: 'block', fontSize: 10.5, fontWeight: 600,
      letterSpacing: '0.12em', textTransform: 'uppercase' as const,
      color: '#78716C', marginBottom: 5,
    },
    row:   { marginBottom: 14 },
    input: {
      width: '100%', boxSizing: 'border-box' as const,
      border: '1px solid #E7DFD0', background: '#FFFEF9',
      padding: '8px 10px', fontSize: 13.5, color: '#1C1917',
      outline: 'none', fontFamily: 'inherit',
    },
    footer: {
      display: 'flex', justifyContent: 'space-between', gap: 8,
      paddingTop: 16, borderTop: '1px solid #F0EADD', marginTop: 4,
    },
    btnClear:  { background: 'none', border: '1px solid #E7DFD0', padding: '7px 14px', fontSize: 12.5, color: '#7A1F2B', cursor: 'pointer', fontFamily: 'inherit' },
    btnCancel: { background: 'none', border: '1px solid #E7DFD0', padding: '7px 14px', fontSize: 12.5, color: '#78716C', cursor: 'pointer', fontFamily: 'inherit' },
    btnSave:   { background: '#1C1917', border: 'none', padding: '7px 18px', fontSize: 12.5, color: '#FBF8F1', cursor: 'pointer', fontFamily: 'inherit' },
    catName:   { fontSize: 12, color: '#78716C', marginBottom: 14 },
  };

  return (
    <div style={MS.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MS.modal}>
        <div style={MS.header}>
          <h2 style={MS.title}>
            <Target size={14} style={{ marginRight: 7, verticalAlign: 'middle', color: '#78716C' }} />
            Goal
          </h2>
        </div>
        <div style={MS.body}>
          <div style={MS.catName}>{cat.name}</div>
          <form onSubmit={handleSubmit}>
            <div style={MS.row}>
              <label style={MS.label} htmlFor="goal-type">Goal type</label>
              <select
                id="goal-type" style={MS.input} value={goalType}
                onChange={(e) => setGoalType(e.target.value)}
              >
                <option value="">No goal</option>
                <option value="target_by_date">Target by date — save $X by a date</option>
                <option value="monthly_savings">Monthly savings — assign $X/month</option>
                <option value="monthly_minimum">Monthly minimum — spend at least $X/month</option>
              </select>
            </div>

            {goalType && (
              <div style={MS.row}>
                <label style={MS.label} htmlFor="goal-amount">
                  {goalType === 'target_by_date' ? 'Target amount' : 'Monthly amount'}
                </label>
                <input
                  id="goal-amount" style={MS.input} type="number"
                  step="0.01" min="0" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00" autoFocus
                />
              </div>
            )}

            {goalType === 'target_by_date' && (
              <div style={MS.row}>
                <label style={MS.label} htmlFor="goal-date">Target date</label>
                <input
                  id="goal-date" style={MS.input} type="date"
                  value={date} onChange={(e) => setDate(e.target.value)}
                />
              </div>
            )}

            {mutation.isError && (
              <p style={{ fontSize: 12, color: '#7A1F2B', marginBottom: 10 }}>
                {(mutation.error as Error).message}
              </p>
            )}

            <div style={MS.footer}>
              <button
                type="button" style={MS.btnClear}
                onClick={handleClear} disabled={!cat.goalType || mutation.isPending}
              >
                Clear
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={MS.btnCancel} onClick={onClose}>Cancel</button>
                <button type="submit" style={MS.btnSave} disabled={mutation.isPending}>
                  {mutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── CategoryRow ──────────────────────────────────────────────────────────────
// Owns its own goalOpen state so each row manages its modal independently.

function CategoryRow({ cat, group, months, getCatMonth, gridCols, groups }: {
  cat: BudgetCategory;
  group: BudgetGroup;
  months: string[];
  getCatMonth: (catId: string, mi: number) => BudgetCategory | undefined;
  gridCols: string;
  groups: BudgetGroup[];
}) {
  const [goalOpen, setGoalOpen] = useState(false);

  return (
    <>
      <div
        style={{ ...budgetGridStyle(gridCols), borderBottom: '1px solid #F0EADD', background: '#FBF8F1', alignItems: 'center', minHeight: 42 }}
        data-budget-grid-row
      >
        <EditableCategoryName cat={cat} currentGroupId={group.id} groups={groups} />
        {months.map((m, mi) => {
          const d      = getCatMonth(cat.id, mi);
          const avail  = d?.availableCents ?? 0;
          // Merge goal fields from primary cat (always present) with current-month budget values
          const merged: BudgetCategory = d ? { ...cat, ...d } : cat;
          return (
            <Fragment key={m}>
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
              <div style={{ paddingRight: 10, paddingTop: 6, paddingBottom: mi === 0 && !group.isIncome ? 4 : 6 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', fontSize: 13, textAlign: 'right', ...availStyle(avail) }}>
                  {fmt$(avail)}
                </div>
                {mi === 0 && !group.isIncome && (
                  <GoalProgressBar cat={merged} onEdit={() => setGoalOpen(true)} />
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
      {goalOpen && <GoalModal cat={cat} onClose={() => setGoalOpen(false)} />}
    </>
  );
}

// ─── HiddenGroupRow ───────────────────────────────────────────────────────────

function HiddenGroupRow({ group, visibleGroups }: { group: HiddenGroup; visibleGroups: BudgetGroup[] }) {
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const unhide = useMutation({
    mutationFn: () => fetch(`/api/categories/groups/${group.id}/restore`, { method: 'POST' }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['categories', 'hidden'] }); },
  });

  const moveCategory = useMutation({
    mutationFn: ({ catId, groupId }: { catId: string; groupId: string }) => patchCategory(catId, { groupId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['categories', 'hidden'] }); },
  });

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px solid #F0EADD' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#78716C', marginBottom: 4 }}>{group.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {group.categories.map((cat) => (
            <div key={cat.id} style={{ position: 'relative' }} ref={menuOpen ? menuRef : null}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F4EFE6', borderRadius: 4, padding: '3px 8px', fontSize: 12, color: '#57534E' }}>
                <span>{cat.name}</span>
                {visibleGroups.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setMenuOpen(o => !o)}
                      title="Move to group"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#A8A29E', fontSize: 11, fontFamily: 'inherit', lineHeight: 1 }}
                    >
                      ⋯
                    </button>
                    {menuOpen && (
                      <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 50, background: 'white', border: '1px solid #E7DFD0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 160, padding: '4px 0' }}>
                        <div style={{ fontSize: 10, color: '#A8A29E', padding: '4px 12px 2px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Move to</div>
                        {visibleGroups.map((g) => (
                          <button
                            key={g.id}
                            onClick={() => { moveCategory.mutate({ catId: cat.id, groupId: g.id }); setMenuOpen(false); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 13, color: '#1C1917', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#F4EFE6')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >
                            {g.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={() => unhide.mutate()}
        disabled={unhide.isPending}
        style={{ fontSize: 11, color: '#365142', background: 'none', border: '1px solid #365142', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
      >
        Restore group
      </button>
    </div>
  );
}

// ─── BudgetPage ───────────────────────────────────────────────────────────────

export function BudgetPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [numMonths, setNumMonths] = useState<1 | 2 | 3>(readStoredNumMonths);
  const [newGroupName, setNewGroupName] = useState('');
  const [overspentDismissed, setOverspentDismissed] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('budget:numMonths', String(numMonths));
  }, [numMonths]);

  useEffect(() => {
    setOverspentDismissed(false);
  }, [month]);

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

  const { data: hiddenGroups = [] } = useQuery<HiddenGroup[]>({
    queryKey: ['categories', 'hidden'],
    queryFn: fetchHiddenGroups,
  });

  const overspentCategories = (primaryData?.groups ?? [])
    .filter((g) => g.isIncome === false)
    .flatMap((g) => g.categories)
    .filter((c) => c.availableCents < 0);

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

  const copyPrev = useMutation({
    mutationFn: () => copyBudgetFromPrevMonth(shiftMonth(month, -1), month),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget'] }),
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

        <button
          onClick={() => copyPrev.mutate()}
          disabled={copyPrev.isPending}
          title={`Copy assignments from ${monthLabel(shiftMonth(month, -1))}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid #E7DFD0', cursor: 'pointer',
            padding: '5px 12px', fontSize: 12, color: '#78716C', fontFamily: 'inherit',
            whiteSpace: 'nowrap' as const,
            opacity: copyPrev.isPending ? 0.5 : 1,
          }}
        >
          <Copy size={13} />
          {copyPrev.isPending ? 'Copying…' : 'Copy prev month'}
        </button>

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

      {/* Overspent categories banner */}
      {!overspentDismissed && overspentCategories.length > 0 && (
        <div style={{
          background: '#FFFBEB',
          border: '1px solid #FDE68A',
          color: '#92400E',
          fontSize: 12,
          padding: '10px 14px',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>
            {'⚠ Overspent: '}
            {overspentCategories.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ' · '}
                {c.name} {'−'}
                {Math.abs(c.availableCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            ))}
          </span>
          <button
            onClick={() => setOverspentDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#92400E',
              fontSize: 16,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

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
                  <CategoryRow
                    key={cat.id}
                    cat={cat}
                    group={group}
                    months={months}
                    getCatMonth={getCatMonth}
                    gridCols={gridCols}
                    groups={primaryData.groups}
                  />
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

      {/* Hidden groups */}
      {hiddenGroups.length > 0 && (
        <div style={{ marginTop: 24, borderTop: '1px solid #E7DFD0', paddingTop: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A8A29E', marginBottom: 8 }}>
            Hidden Groups
          </div>
          {hiddenGroups.map((g) => (
            <HiddenGroupRow key={g.id} group={g} visibleGroups={primaryData?.groups ?? []} />
          ))}
        </div>
      )}

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
