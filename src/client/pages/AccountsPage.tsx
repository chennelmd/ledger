import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import type { Account } from '../../db/schema.js';
import { AddAccountModal } from '../components/AddAccountModal.js';

type AccountWithBalance = Account & { balanceCents: number; debtCategoryId?: string | null };

async function fetchAccounts(): Promise<AccountWithBalance[]> {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('failed to fetch accounts');
  return res.json();
}

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const SECTION_ORDER: Array<AccountWithBalance['type']> = ['asset', 'liability', 'tracking'];
const SECTION_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  tracking: 'Tracking',
};

export function AccountsPage({ onNavigateToLedger }: { onNavigateToLedger: (accountId: string) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountWithBalance | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
  });

  // Compute net worth summary
  const totalAssets = data
    ? data.filter(a => a.type === 'asset').reduce((sum, a) => sum + a.balanceCents, 0)
    : 0;
  const totalLiabilities = data
    ? data.filter(a => a.type === 'liability').reduce((sum, a) => sum + Math.abs(a.balanceCents), 0)
    : 0;
  const netWorth = totalAssets - totalLiabilities;

  // Group accounts by type
  const grouped = data
    ? SECTION_ORDER.reduce<Record<string, AccountWithBalance[]>>((acc, type) => {
        const accounts = data.filter(a => a.type === type);
        if (accounts.length > 0) acc[type] = accounts;
        return acc;
      }, {})
    : {};

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

      {data && data.length > 0 && (
        <>
          {/* Net Worth Summary Bar */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            background: '#FBF8F1',
            border: '1px solid #E7DFD0',
            padding: '18px 20px',
            marginBottom: 24,
          }}>
            {[
              { label: 'Total Assets', value: totalAssets, color: undefined },
              { label: 'Total Liabilities', value: totalLiabilities, color: undefined },
              { label: 'Net Worth', value: netWorth, color: netWorth >= 0 ? '#365142' : '#7A1F2B' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#78716C',
                  marginBottom: 6,
                }}>
                  {label}
                </div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 20,
                  fontWeight: 600,
                  color: color,
                }}>
                  {fmt$(value)}
                </div>
              </div>
            ))}
          </div>

          {/* Grouped Account Sections */}
          {SECTION_ORDER.filter(type => grouped[type]).map(type => {
            const accounts = grouped[type];
            const subtotal = accounts.reduce((sum, a) => sum + a.balanceCents, 0);
            return (
              <div key={type} style={{ marginBottom: 16 }}>
                {/* Section header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 20px',
                  background: '#F5F0E8',
                  border: '1px solid #E7DFD0',
                  borderBottom: 'none',
                }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: '#78716C',
                  }}>
                    {SECTION_LABEL[type]}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#78716C',
                  }}>
                    {fmt$(subtotal)}
                  </span>
                </div>

                {/* Account rows */}
                <div style={{ background: '#FBF8F1', border: '1px solid #E7DFD0' }}>
                  {accounts.map((a) => (
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
              </div>
            );
          })}
        </>
      )}

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
    </>
  );
}
