import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ─── types ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  groupId: string;
  name: string;
  isIncome: boolean;
  sortOrder: number;
}

interface CategoryGroup {
  id: string;
  name: string;
  isIncome: boolean;
  sortOrder: number;
  categories: Category[];
}

// ─── api ─────────────────────────────────────────────────────────────────────

async function fetchCategories(): Promise<CategoryGroup[]> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('failed to fetch categories');
  return res.json();
}

async function postGroup(name: string) {
  const res = await fetch('/api/categories/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('failed to create group');
  return res.json();
}

async function patchGroup(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/categories/groups/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('failed to update group');
  return res.json();
}

async function postCategory(groupId: string, name: string) {
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, name }),
  });
  if (!res.ok) throw new Error('failed to create category');
  return res.json();
}

// ─── styles ──────────────────────────────────────────────────────────────────

const S = {
  groupBlock: {
    marginBottom: 24,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #1C1917',
    marginBottom: 0,
  },
  groupName: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: '#1C1917',
  },
  categoryRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid #F0EADD',
    background: '#FBF8F1',
    fontSize: 13.5,
    color: '#1C1917',
  },
  inlineForm: {
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
    borderTop: 'none',
  },
  inlineInput: {
    flex: 1,
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '6px 8px',
    fontSize: 13,
    color: '#1C1917',
    outline: 'none',
    fontFamily: 'inherit',
  },
  inlineBtn: {
    background: '#1C1917',
    border: 'none',
    color: '#FBF8F1',
    padding: '6px 14px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  addGroupRow: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  addGroupInput: {
    flex: 1,
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '8px 10px',
    fontSize: 13.5,
    color: '#1C1917',
    outline: 'none',
    fontFamily: 'inherit',
  },
  addGroupBtn: {
    background: 'none',
    border: '1px solid #E7DFD0',
    color: '#78716C',
    padding: '8px 16px',
    fontSize: 12.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  empty: {
    padding: '10px 12px',
    fontSize: 12.5,
    color: '#A8A29E',
    background: '#FBF8F1',
    borderBottom: '1px solid #F0EADD',
    fontStyle: 'italic',
  },
};

// ─── sub-components ───────────────────────────────────────────────────────────

function IncomeToggle({ group }: { group: CategoryGroup }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => patchGroup(group.id, { isIncome: !group.isIncome }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      style={{
        background: group.isIncome ? '#1C1917' : 'none',
        border: '1px solid',
        borderColor: group.isIncome ? '#1C1917' : '#D5CCB8',
        color: group.isIncome ? '#FBF8F1' : '#A8A29E',
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase' as const,
        padding: '2px 8px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      Income
    </button>
  );
}

function AddCategoryRow({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => postCategory(groupId, name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setName('');
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <div style={{ ...S.inlineForm, cursor: 'pointer' }} onClick={() => setOpen(true)}>
        <span style={{ fontSize: 12, color: '#A8A29E', letterSpacing: '0.04em' }}>+ Add category</span>
      </div>
    );
  }

  return (
    <form
      style={S.inlineForm}
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}
    >
      <input
        style={S.inlineInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setName(''); } }}
      />
      <button type="submit" style={S.inlineBtn} disabled={!name.trim() || mutation.isPending}>
        {mutation.isPending ? '…' : 'Add'}
      </button>
      <button
        type="button"
        style={{ ...S.inlineBtn, background: 'none', color: '#78716C', border: '1px solid #E7DFD0' }}
        onClick={() => { setOpen(false); setName(''); }}
      >
        Cancel
      </button>
    </form>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function CategoriesPage() {
  const qc = useQueryClient();
  const [newGroupName, setNewGroupName] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  });

  const addGroup = useMutation({
    mutationFn: () => postGroup(newGroupName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setNewGroupName('');
    },
  });

  return (
    <div>
      {isLoading && <p style={{ color: '#78716C' }}>Loading…</p>}
      {error && <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>}

      {data && data.length === 0 && (
        <p style={{ color: '#78716C', marginBottom: 24 }}>
          No categories yet. Add a group below to get started.
        </p>
      )}

      {data?.map((group) => (
        <div key={group.id} style={S.groupBlock}>
          <div style={S.groupHeader}>
            <span style={S.groupName}>{group.name}</span>
            <IncomeToggle group={group} />
          </div>

          <div style={{ border: '1px solid #E7DFD0', borderTop: 'none' }}>
            {group.categories.length === 0 && (
              <div style={S.empty}>No categories yet</div>
            )}
            {group.categories.map((cat) => (
              <div key={cat.id} style={S.categoryRow}>
                <span>{cat.name}</span>
              </div>
            ))}
            <AddCategoryRow groupId={group.id} />
          </div>
        </div>
      ))}

      {/* Add group */}
      <div style={{ marginTop: data && data.length > 0 ? 8 : 0 }}>
        <div style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#78716C',
          marginBottom: 8,
        }}>
          New Group
        </div>
        <form
          style={S.addGroupRow}
          onSubmit={(e) => { e.preventDefault(); if (newGroupName.trim()) addGroup.mutate(); }}
        >
          <input
            style={S.addGroupInput}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g. Fixed Expenses"
          />
          <button
            type="submit"
            style={S.addGroupBtn}
            disabled={!newGroupName.trim() || addGroup.isPending}
          >
            {addGroup.isPending ? 'Adding…' : 'Add Group'}
          </button>
        </form>
      </div>
    </div>
  );
}
