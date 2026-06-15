import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sankey, Tooltip as RechartsTooltip, Rectangle } from 'recharts';
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
  accountType: string | null;
  payeeName: string | null;
  notes: string | null;
  categoryName: string | null;
  categoryGroupId: string | null;
  categoryGroupName: string | null;
  accountName: string | null;
  transferAccountName: string | null;
};

type Schedule = {
  id: string;
  name: string;
  amountCents: number;
  nextOccurrence: string;
  upcomingOccurrences: string[];
  categoryName: string | null;
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

async function fetchMonthTransactions(since: string, until: string): Promise<Transaction[]> {
  const res = await fetch(`/api/transactions?since=${since}&until=${until}&limit=500`);
  if (!res.ok) throw new Error('failed to fetch month transactions');
  return res.json();
}

async function fetchUpcomingSchedules(): Promise<Schedule[]> {
  const res = await fetch('/api/schedules?days=14');
  if (!res.ok) throw new Error('failed to fetch schedules');
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

function monthBounds(month: string) {
  const [year, m] = month.split('-').map(Number);
  const since = `${year}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const until = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { since, until };
}

// ─── shared styles ────────────────────────────────────────────────────────────

const sectionEyebrow: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#A8A29E',
  fontWeight: 500,
  marginBottom: 12,
};

const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #E7DFD0',
  margin: '0 0 20px',
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

// ── Report: Income vs Expenses ────────────────────────────────────────────────

function IncomeVsExpenses({ txs }: { txs: Transaction[] }) {
  const assetTxs = txs.filter(t => t.accountType === 'asset' && !t.transferAccountName);
  const income   = assetTxs.filter(t => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const expenses = assetTxs.filter(t => t.amountCents < 0).reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const net      = income - expenses;

  const barMax = Math.max(income, expenses, 1);

  return (
    <div>
      <div style={sectionEyebrow}>Income vs. expenses</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Income */}
        <div style={{ background: '#F8F4EE', border: '1px solid #E7DFD0', borderRadius: 6, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A8A29E', fontWeight: 500, marginBottom: 6 }}>In</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, color: '#365142' }}>{fmt$(income)}</div>
          <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: '#E7DFD0', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(income / barMax) * 100}%`, background: '#365142', borderRadius: 2 }} />
          </div>
        </div>
        {/* Expenses */}
        <div style={{ background: '#F8F4EE', border: '1px solid #E7DFD0', borderRadius: 6, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A8A29E', fontWeight: 500, marginBottom: 6 }}>Out</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, color: expenses > income ? '#7A1F2B' : '#1C1917' }}>{fmt$(expenses)}</div>
          <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: '#E7DFD0', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(expenses / barMax) * 100}%`, background: expenses > income ? '#7A1F2B' : '#78716C', borderRadius: 2 }} />
          </div>
        </div>
      </div>
      {income > 0 || expenses > 0 ? (
        <div style={{ fontSize: 12.5, color: net >= 0 ? '#365142' : '#7A1F2B' }}>
          {net >= 0 ? '+' : ''}{fmt$(net)} net this month
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: '#A8A29E' }}>No transactions this month yet.</div>
      )}
    </div>
  );
}

// ── Report: Upcoming Cash Impact ──────────────────────────────────────────────

function UpcomingCashImpact({ schedules, freeCashCents }: { schedules: Schedule[]; freeCashCents: number }) {
  type BillItem = { date: string; name: string; amountCents: number };
  const items: BillItem[] = [];

  schedules.forEach(s => {
    s.upcomingOccurrences.forEach(date => {
      items.push({ date, name: s.name, amountCents: s.amountCents });
    });
  });
  items.sort((a, b) => a.date.localeCompare(b.date));

  let running = freeCashCents;

  return (
    <div>
      <div style={sectionEyebrow}>Upcoming cash impact — next 14 days</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#A8A29E' }}>No scheduled bills in the next 14 days.</div>
      ) : (
        <div style={{ border: '1px solid #E7DFD0', borderRadius: 6, overflow: 'hidden' }}>
          {items.map((item, idx) => {
            running += item.amountCents;
            const balColor = running < 0 ? '#7A1F2B' : running < 20000 ? '#B45309' : '#365142';
            return (
              <div key={idx} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: idx < items.length - 1 ? '1px solid #F0EADD' : 'none',
                background: '#F8F4EE',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1C1917' }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: '#A8A29E', marginTop: 1 }}>{shortDate(item.date)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, color: '#78716C', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt$(item.amountCents)}
                  </div>
                  <div style={{ fontSize: 11, color: balColor, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                    → {fmt$(running)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Report: Sankey ────────────────────────────────────────────────────────────

const SANKEY_COLORS = [
  '#8B7355', '#6B8F71', '#7B6B8F', '#8F7B6B',
  '#5F7A8A', '#8A6B6B', '#7A8A5F', '#8A7A5F',
];

function MoneyFlowSankey({ txs, width = 500 }: { txs: Transaction[]; width?: number }) {
  const assetTxs = txs.filter(t => t.accountType === 'asset' && !t.transferAccountName);
  const income   = assetTxs.filter(t => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);

  const byGroup = new Map<string, number>();
  assetTxs.filter(t => t.amountCents < 0 && t.categoryGroupName).forEach(t => {
    const g = t.categoryGroupName!;
    byGroup.set(g, (byGroup.get(g) ?? 0) + Math.abs(t.amountCents));
  });

  const totalExpenses = Array.from(byGroup.values()).reduce((s, v) => s + v, 0);
  const unassigned    = income - totalExpenses;
  const groupNames    = Array.from(byGroup.keys());

  if (income === 0 && totalExpenses === 0) {
    return (
      <div>
        <div style={sectionEyebrow}>Money flow by category group</div>
        <div style={{ fontSize: 12.5, color: '#A8A29E' }}>No income or spending data this month yet.</div>
      </div>
    );
  }

  const nodes = [
    { name: 'Income' },
    ...groupNames.map(name => ({ name })),
    ...(unassigned > 0 ? [{ name: 'Unassigned' }] : []),
  ];

  const links = [
    ...groupNames.map((name, i) => ({
      source: 0,
      target: i + 1,
      value: Math.max(1, Math.round(byGroup.get(name)! / 100)),
    })),
    ...(unassigned > 0 ? [{
      source: 0,
      target: groupNames.length + 1,
      value: Math.max(1, Math.round(unassigned / 100)),
    }] : []),
  ];

  return (
    <div>
      <div style={sectionEyebrow}>Money flow by category group</div>
      <Sankey
        width={width}
        height={Math.max(180, nodes.length * 48)}
        data={{ nodes, links }}
        nodePadding={16}
        nodeWidth={12}
        link={{ stroke: '#E7DFD0', strokeOpacity: 0.6 }}
        node={({ x, y, width, height, index, payload }: any) => {
          const color = index === 0
            ? '#365142'
            : payload.name === 'Unassigned'
              ? '#78716C'
              : SANKEY_COLORS[(index - 1) % SANKEY_COLORS.length];
          return (
            <g>
              <Rectangle x={x} y={y} width={width} height={height} fill={color} radius={2} />
              <text
                x={index === 0 ? x - 6 : x + width + 6}
                y={y + height / 2}
                textAnchor={index === 0 ? 'end' : 'start'}
                dominantBaseline="middle"
                style={{ fontSize: 11, fill: '#78716C', fontFamily: 'DM Sans, sans-serif' }}
              >
                {payload.name}
              </text>
            </g>
          );
        }}
      >
        <RechartsTooltip
          formatter={(value: number) =>
            [`$${value.toLocaleString('en-US', { minimumFractionDigits: 0 })}`, '']}
          contentStyle={{
            background: '#1C1917',
            border: 'none',
            borderRadius: 4,
            color: '#FBF8F1',
            fontSize: 12,
            padding: '6px 10px',
          }}
          itemStyle={{ color: '#FBF8F1' }}
          labelStyle={{ display: 'none' }}
        />
      </Sankey>
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

  const { since, until } = data ? monthBounds(data.month) : { since: '', until: '' };

  const { data: monthTxs = [] } = useQuery({
    queryKey: ['transactions', 'month', since],
    queryFn: () => fetchMonthTransactions(since, until),
    enabled: !!since,
  });

  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ['schedules', 'upcoming-14'],
    queryFn: fetchUpcomingSchedules,
  });

  if (isLoading) return <p style={{ color: '#78716C' }}>Loading…</p>;
  if (error || !data) return <p style={{ color: '#7A1F2B' }}>Error loading dashboard.</p>;

  const freeCashColor = data.freeCashCents < 0 ? '#7A1F2B' : '#365142';
  const netWorth = accounts.reduce((sum, a) => sum + a.balanceCents, 0);

  return (
    <div>

      {/* Header */}
      <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#A8A29E', marginBottom: 4, fontWeight: 500 }}>
        {monthLabel(data.month)}
      </div>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', color: '#1C1917', margin: '0 0 24px' }}>
        Dashboard
      </h1>

      {/* Unassigned cash hero */}
      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A8A29E', fontWeight: 500, marginBottom: 4 }}>
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
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', gap: 24, fontWeight: 500 }}>
            <span>Unassigned cash</span><span>{fmt$(data.freeCashCents)}</span>
          </div>
        </div>
      }>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 52, fontWeight: 400, letterSpacing: '-0.02em', color: freeCashColor, lineHeight: 1, marginBottom: 28, cursor: 'default' }}>
          {fmt$(data.freeCashCents)}
        </div>
      </Tooltip>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 28 }}>
        <SummaryCard label="Cash" value={fmt$(data.cashBalanceCents)} sub="total in accounts" />
        <SummaryCard label="Reserved" value={fmt$(data.reservedEnvelopeCents)} sub="budgeted to envelopes" />
        <SummaryCard label="Net worth" value={fmt$(netWorth)} sub="across all accounts" />
      </div>

      {/* Two-column layout */}
      <hr style={divider} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) 1px minmax(0, 1fr)', gap: 48, alignItems: 'start' }}>

        {/* Left: Reports */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <IncomeVsExpenses txs={monthTxs} />
          <hr style={{ ...divider, margin: 0 }} />
          <UpcomingCashImpact schedules={schedules} freeCashCents={data.freeCashCents} />
          <hr style={{ ...divider, margin: 0 }} />
          <MoneyFlowSankey txs={monthTxs} width={500} />
        </div>

        {/* Vertical divider */}
        <div style={{ background: '#E7DFD0', alignSelf: 'stretch' }} />

        {/* Right: Recent transactions */}
        <div>
          <div style={sectionEyebrow}>Recent transactions</div>
          {recentTx.length === 0 ? (
            <p style={{ color: '#A8A29E', fontSize: 13 }}>No transactions yet.</p>
          ) : (
            recentTx.map((tx, idx) => {
              const payee = tx.payeeName
                || (tx.transferAccountName ? `Transfer → ${tx.transferAccountName}` : null)
                || tx.notes || '—';
              const meta = [tx.categoryName, tx.accountName].filter(Boolean).join(' · ');
              const isIncome = tx.amountCents > 0;
              return (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: idx < recentTx.length - 1 ? '1px solid #F0EADD' : 'none' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1917' }}>{payee}</div>
                    {meta && <div style={{ fontSize: 11.5, color: '#A8A29E', marginTop: 2 }}>{meta}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <div style={{ fontSize: 13.5, color: isIncome ? '#365142' : '#1C1917', fontVariantNumeric: 'tabular-nums' }}>
                      {isIncome ? '+' : ''}{fmt$(tx.amountCents)}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#A8A29E', marginTop: 2 }}>{shortDate(tx.date)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
