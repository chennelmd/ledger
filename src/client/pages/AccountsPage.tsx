import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import type { Account } from '../../db/schema.js';
import { AddAccountModal } from '../components/AddAccountModal.js';

type AccountWithBalance = Account & { balanceCents: number };

async function fetchAccounts(): Promise<AccountWithBalance[]> {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('failed to fetch accounts');
  return res.json();
}

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function AccountsPage({ onNavigateToLedger }: { onNavigateToLedger: (accountId: string) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountWithBalance | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
  });

  return (
    <>
      {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} />}
      {editingAccount && (
        <AddAccountModal account={editingAccount} onClose={() => setEditingAccount(null)} />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            background: '#1C1917',
            border: 'none',
            color: '#FBF8F1',
            padding: '9px 18px',
            fontSize: 12.5,
            letterSpacing: '0.06em',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          + New Account
        </button>
      </div>

      {isLoading && <p style={{ color: '#78716C' }}>Loading…</p>}
      {error && <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>}

      {data && data.length === 0 && (
        <div style={{
          padding: 40,
          background: '#FBF8F1',
          border: '1px solid #E7DFD0',
          textAlign: 'center',
        }}>
          <p style={{ color: '#78716C', margin: 0 }}>No accounts yet. Add one to get started.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div style={{ background: '#FBF8F1', border: '1px solid #E7DFD0' }}>
          {data.map((a) => (
            <div
              key={a.id}
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #F0EADD',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <button
                  onClick={() => onNavigateToLedger(a.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    fontWeight: 500,
                    color: '#1C1917',
                    cursor: 'pointer',
                    textAlign: 'left',
                    textDecoration: 'underline',
                    textDecorationColor: '#E7DFD0',
                    textUnderlineOffset: 3,
                  }}
                >
                  {a.name}
                </button>
                <div style={{ fontSize: 11.5, color: '#78716C', marginTop: 2 }}>
                  {a.type} · {a.subtype}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  color: a.balanceCents < 0 ? '#7A1F2B' : 'inherit',
                }}>
                  {fmt$(a.balanceCents)}
                </div>
                <button
                  onClick={() => setEditingAccount(a)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#C5BDB5',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  aria-label={`Edit ${a.name}`}
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
