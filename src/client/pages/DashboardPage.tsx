import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Account } from '../../db/schema.js';

// ─── types ────────────────────────────────────────────────────────────────────

type FreeCashResponse = {
  month: string;
  cashBalanceCents: number;
  reservedEnvelopeCents: number;
  debtPaymentCents: number;
  scheduledOutflowsCents: number;
  uncoveredScheduledOutflowsCents: number;
  freeCashCents: number;
  cashAccounts: Array<{ id: string; name: string; subtype: string; balanceCents: number }>;
  reservedCategories: Array<{ id: string; name: string; groupName: string; availableCents: number }>;
};

type Transaction = {
  id: string;
  date: string;
  amountCents: number;
  payeeName: string | null;
  notes: string | null;
  categoryName: string | null;
  accountName: string | null;
  transferAccountName: string | null;
};

type AccountWithBalance = Account & { balanceCents: number };

// ─── fetchers ─────────────────────────────────────────────────────────────────

async function fetchFreeCash(): Promise<FreeCashResponse> {
  const res = await fetch('/api/dashboard/free-cash');
  if (!res.ok) throw new Error('failed to fetch free cash');
  return res.json();
}

async function fetchRecentTransactions(): Promise<Transaction[]> {
  const res = await fetch('/api/transactions?limit=6');
  if (!res.ok) throw new Error('failed to fetch transactions');
  return res.json();
}

async function fetchAccounts(): Promise<AccountWithBalance[]> {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('failed to fetch accounts');
  return res.json();
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const monthLabel = (month: string) => {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

const shortDate = (iso: string) => {
  const [year, m, d] = iso.split('-').map(Number);
  return new Date(year, m - 1, d).toLocaleString('en-US', { month: 'short', day: 'numeric' });
};

// ─── sub-components ───────────────────────────────────────────────────────────

function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: 0,
          background: '#1C1917',
          color: '#FBF8F1',
          padding: '10px 14px',
          fontSize: 12,
          lineHeight: 1.6,
          width: 'max-content',
          maxWidth: 280,
          zIndex: 200,
          pointerEvents: 'none',
          borderRadius: 4,
        }}>
          {content}
        </div>
      )}
    </span>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{
      background: '#F8F4EE',
      border: '1px solid #E7DFD0',
      borderRadius: 6,
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#A8A29E',
        marginBottom: 6,
        fontWeight: 500,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Fraunces', serif",
        fontSize: 22,
        fontWeight: 400,
        letterSpacing: '-0.01em',
        color: '#1C1917',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: '#A8A29E', marginTop: 3 }}>{sub}</div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'free-cash'],
    queryFn: fetchFreeCash,
  });

  const { data: recentTx = [] } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: fetchRecentTransactions,
  });

  const { data: accounts = [] } = useQuery<AccountWithBalance[]>({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
  });

  if (isLoading) return <p style={{ color: '#78716C' }}>Loading…</p>;
  if (error || !data) return <p style={{ color: '#7A1F2B' }}>Error loading dashboard.</p>;

  const freeCashColor = data.freeCashCents < 0 ? '#7A1F2B' : '#365142';

  const netWorth = accounts.reduce((sum, a) => sum + a.balanceCents, 0);

  return (
    <div style={{ maxWidth: 720 }}>

      {/* Header */}
      <div style={{
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: '#A8A29E',
        marginBottom: 4,
        fontWeight: 500,
      }}>
        {monthLabel(data.month)}
      </div>
      <h1 style={{
        fontFamily: "'Fraunces', serif",
        fontSize: 32,
        fontWeight: 500,
        letterSpacing: '-0.02em',
        color: '#1C1917',
        margin: '0 0 24px',
      }}>
        Dashboard
      </h1>

      {/* Unassigned cash hero */}
      <div style={{
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#A8A29E',
        fontWeight: 500,
        marginBottom: 4,
      }}>
        Unassigned cash
      </div>
      <Tooltip content={
        <div style={{ fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
            <span>Cash accounts</span><span>{fmt$(data.cashBalanceCents)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
            <span>Reserved for budget</span><span>−{fmt$(data.reservedEnvelopeCents)}</span>
          </div>
          {data.debtPaymentCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <span>Debt payments</span><span>−{fmt$(data.debtPaymentCents)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
            <span>Scheduled – Unbudgeted</span><span>−{fmt$(data.uncoveredScheduledOutflowsCents)}</span>
          </div>
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.2)',
            marginTop: 6,
            paddingTop: 6,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 24,
            fontWeight: 500,
          }}>
            <span>Unassigned cash</span><span>{fmt$(data.freeCashCents)}</span>
          </div>
        </div>
      }>
        <div style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 52,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: freeCashColor,
          lineHeight: 1,
          marginBottom: 28,
          cursor: 'default',
        }}>
          {fmt$(data.freeCashCents)}
        </div>
      </Tooltip>

      {/* Summary cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 12,
        marginBottom: 28,
      }}>
        <SummaryCard
          label="Cash"
          value={fmt$(data.cashBalanceCents)}
          sub="total in accounts"
        />
        <SummaryCard
          label="Reserved"
          value={fmt$(data.reservedEnvelopeCents)}
          sub="budgeted to envelopes"
        />
        <SummaryCard
          label="Net worth"
          value={fmt$(netWorth)}
          sub="across all accounts"
        />
      </div>

      {/* Recent transactions */}
      <hr style={{ border: 'none', borderTop: '1px solid #E7DFD0', margin: '0 0 20px' }} />

      <div style={{
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#A8A29E',
        fontWeight: 500,
        marginBottom: 12,
      }}>
        Recent transactions
      </div>

      {recentTx.length === 0 ? (
        <p style={{ color: '#A8A29E', fontSize: 13 }}>No transactions yet.</p>
      ) : (
        recentTx.map((tx, idx) => {
          const payee = tx.payeeName
            || (tx.transferAccountName ? `Transfer → ${tx.transferAccountName}` : null)
            || tx.notes
            || '—';
          const meta = [tx.categoryName, tx.accountName].filter(Boolean).join(' · ');
          const isIncome = tx.amountCents > 0;

          return (
            <div
              key={tx.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 0',
                borderBottom: idx < recentTx.length - 1 ? '1px solid #F0EADD' : 'none',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1917' }}>{payee}</div>
                {meta && (
                  <div style={{ fontSize: 11.5, color: '#A8A29E', marginTop: 2 }}>{meta}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                <div style={{
                  fontSize: 13.5,
                  color: isIncome ? '#365142' : '#1C1917',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {isIncome ? '+' : ''}{fmt$(tx.amountCents)}
                </div>
                <div style={{ fontSize: 11.5, color: '#A8A29E', marginTop: 2 }}>
                  {shortDate(tx.date)}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
