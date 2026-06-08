import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

type FreeCashResponse = {
  month: string;
  cashBalanceCents: number;
  reservedEnvelopeCents: number;
  debtPaymentCents: number;
  scheduledOutflowsCents: number;
  uncoveredScheduledOutflowsCents: number;
  freeCashCents: number;
  freeCashEOMCents: number;
  uncoveredScheduledOutflowsEOMCents: number;
  prevMonthNetCents: number;
  cashAccounts: Array<{ id: string; name: string; subtype: string; balanceCents: number }>;
  reservedCategories: Array<{ id: string; name: string; groupName: string; availableCents: number }>;
};

async function fetchFreeCash(): Promise<FreeCashResponse> {
  const res = await fetch('/api/dashboard/free-cash');
  if (!res.ok) throw new Error('failed to fetch free cash');
  return res.json();
}

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtSubtract$ = (cents: number) => cents === 0 ? fmt$(0) : `-${fmt$(cents)}`;

const monthLabel = (month: string) => {
  const [year, monthIndex] = month.split('-').map(Number);
  return new Date(year, monthIndex - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

type ActiveView = 'now' | 'eom' | 'per-account';

const VIEW_LABELS: Record<ActiveView, string> = {
  now: 'Right now',
  eom: 'End of month',
  'per-account': 'Per account',
};

const S = {
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    color: '#78716C',
    fontWeight: 600,
  },
  rule: {
    border: 'none',
    borderTop: '1px solid #E7DFD0',
    margin: '12px 0 24px',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)',
    gap: 28,
    alignItems: 'end',
    marginBottom: 36,
  },
  heroNumber: {
    fontFamily: "'Fraunces', serif",
    fontSize: 76,
    lineHeight: 0.95,
    fontWeight: 500,
    letterSpacing: '0',
    margin: '8px 0 0',
    color: '#1C1917',
  },
  subtitle: {
    color: '#78716C',
    margin: '14px 0 0',
    fontSize: 14,
    lineHeight: 1.55,
    maxWidth: 520,
  },
  stats: {
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    padding: '13px 16px',
    borderBottom: '1px solid #F0EADD',
  },
  statLabel: {
    color: '#78716C',
    fontSize: 12.5,
  },
  mono: {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums' as const,
  },
  sectionHeader: {
    marginTop: 34,
  },
  h2: {
    fontFamily: "'Fraunces', serif",
    fontSize: 24,
    fontWeight: 500,
    margin: '4px 0 0',
    color: '#1C1917',
  },
  table: {
    marginTop: 14,
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 140px',
    gap: 16,
    alignItems: 'center',
    padding: '13px 16px',
    borderBottom: '1px solid #F0EADD',
  },
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 140px',
    gap: 16,
    alignItems: 'center',
    padding: '13px 16px',
    borderBottom: '1px solid #E7DFD0',
    background: '#F8F3EA',
  },
  name: {
    color: '#1C1917',
    fontSize: 13.5,
    fontWeight: 500,
  },
  meta: {
    color: '#78716C',
    fontSize: 11.5,
    marginTop: 2,
  },
  empty: {
    padding: 24,
    color: '#78716C',
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
  },
};

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
          bottom: 'calc(100% + 7px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1C1917',
          color: '#FBF8F1',
          padding: '8px 11px',
          fontSize: 11.5,
          lineHeight: 1.55,
          width: 'max-content',
          maxWidth: 260,
          zIndex: 200,
          pointerEvents: 'none',
        }}>
          {content}
        </div>
      )}
    </span>
  );
}

export function DashboardPage() {
  const [activeView, setActiveView] = useState<ActiveView>('now');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'free-cash'],
    queryFn: fetchFreeCash,
  });

  if (isLoading) return <p style={{ color: '#78716C' }}>Loading...</p>;
  if (error) return <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>;
  if (!data) return null;

  // Color: red if negative; amber if positive but cash-minus-reserved fell vs last month; green otherwise.
  const thisMonthNet = data.cashBalanceCents - data.reservedEnvelopeCents - data.debtPaymentCents;
  const trendingDown = data.freeCashCents > 0 && thisMonthNet < data.prevMonthNetCents;
  const freeCashColor = data.freeCashCents < 0 ? '#7A1F2B' : trendingDown ? '#B45309' : '#365142';

  const displayFreeCash = activeView === 'eom' ? data.freeCashEOMCents : data.freeCashCents;
  const displayUncoveredScheduled =
    activeView === 'eom' ? data.uncoveredScheduledOutflowsEOMCents : data.uncoveredScheduledOutflowsCents;
  const displayColor =
    displayFreeCash < 0 ? '#7A1F2B' : trendingDown && activeView === 'now' ? '#B45309' : '#365142';

  const subtitleText: Record<ActiveView, string> = {
    now: 'Right now — next 30 days of scheduled bills deducted',
    eom: `End of ${monthLabel(data.month)} — bills through month-end deducted`,
    'per-account': 'Proportional share of total free cash per account',
  };

  const viewTooltips: Record<ActiveView, string> = {
    now: 'Rolling 30-day window from today. Deducts scheduled transactions due within the next 30 days.',
    eom: `Calendar month view. Deducts only scheduled transactions due by the end of ${monthLabel(data.month)}.`,
    'per-account': 'Shows your total unassigned cash allocated proportionally across each cash account by balance.',
  };

  const monoStyle = { fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' as const };
  const heroTooltip = (
    <div style={{ ...monoStyle, fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
        <span>Cash Accounts</span><span>{fmt$(data.cashBalanceCents)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginTop: 3 }}>
        <span>Reserved for Budget</span><span>−{fmt$(data.reservedEnvelopeCents)}</span>
      </div>
      {data.debtPaymentCents > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginTop: 3 }}>
          <span>Debt Payments</span><span>−{fmt$(data.debtPaymentCents)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginTop: 3 }}>
        <span>{activeView === 'eom' ? 'Scheduled – Unbudgeted (month-end)' : 'Scheduled – Unbudgeted'}</span>
        <span>−{fmt$(displayUncoveredScheduled)}</span>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', gap: 20 }}>
        <span>Unassigned Cash</span><span>{fmt$(displayFreeCash)}</span>
      </div>
    </div>
  );

  return (
    <div>
      <section style={S.hero}>
        <div>
          <div style={S.eyebrow}>Vol. 1 · Unassigned Cash</div>
          <hr style={S.rule} />
          <div style={{ color: '#78716C', fontSize: 12.5 }}>{monthLabel(data.month)}</div>

          {/* View toggle */}
          <div style={{ display: 'flex', marginTop: 16, marginBottom: 4 }}>
            {(['now', 'eom', 'per-account'] as const).map((view, i, arr) => (
              <Tooltip key={view} content={viewTooltips[view]}>
                <button
                  onClick={() => setActiveView(view)}
                  style={{
                    background: activeView === view ? '#1C1917' : 'none',
                    color: activeView === view ? '#FBF8F1' : '#78716C',
                    border: '1px solid #E7DFD0',
                    borderRight: i < arr.length - 1 ? 'none' : '1px solid #E7DFD0',
                    padding: '5px 14px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {VIEW_LABELS[view]}
                </button>
              </Tooltip>
            ))}
          </div>

          {/* Hero number or per-account table */}
          {activeView === 'per-account' ? (
            <div style={{ ...S.table, marginTop: 12 }}>
              <div style={S.summaryRow}>
                <div style={S.name}>Total free cash</div>
                <div style={{ ...S.mono, textAlign: 'right', color: freeCashColor }}>
                  {fmt$(data.freeCashCents)}
                </div>
              </div>
              {data.cashAccounts.length === 0 ? (
                <div style={{ padding: '13px 16px', color: '#78716C', fontSize: 13 }}>No cash accounts.</div>
              ) : (
                data.cashAccounts.map((account, idx) => {
                  const proportion = data.cashBalanceCents !== 0
                    ? account.balanceCents / data.cashBalanceCents
                    : 0;
                  const accountFreeCash = Math.round(proportion * data.freeCashCents);
                  const accountColor = accountFreeCash < 0 ? '#7A1F2B' : '#1C1917';
                  return (
                    <div
                      key={account.id}
                      style={{
                        ...S.row,
                        borderBottom: idx === data.cashAccounts.length - 1 ? 'none' : S.row.borderBottom,
                      }}
                    >
                      <div>
                        <div style={S.name}>{account.name}</div>
                        <div style={S.meta}>{account.subtype} · {fmt$(account.balanceCents)}</div>
                      </div>
                      <div style={{ ...S.mono, textAlign: 'right', color: accountColor }}>
                        {fmt$(accountFreeCash)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <Tooltip content={heroTooltip}>
              <div style={{ ...S.heroNumber, color: displayColor }}>
                {fmt$(displayFreeCash)}
              </div>
            </Tooltip>
          )}

          {trendingDown && activeView === 'now' && (
            <div style={{ color: '#B45309', fontSize: 11, marginTop: 4 }}>
              {'↓ '}{fmt$(Math.abs(thisMonthNet - data.prevMonthNetCents))} vs. last month
            </div>
          )}

          <p style={S.subtitle}>{subtitleText[activeView]}</p>
        </div>

        {activeView !== 'per-account' && (
          <div style={S.stats}>
            <div style={S.statRow}>
              <span style={S.statLabel}>Cash Accounts</span>
              <span style={S.mono}>{fmt$(data.cashBalanceCents)}</span>
            </div>
            <div style={S.statRow}>
              <span style={S.statLabel}>Reserved for Budget</span>
              <span style={S.mono}>{fmtSubtract$(data.reservedEnvelopeCents)}</span>
            </div>
            {data.debtPaymentCents > 0 && (
              <div style={S.statRow}>
                <span style={S.statLabel}>Debt Payments</span>
                <span style={S.mono}>{fmtSubtract$(data.debtPaymentCents)}</span>
              </div>
            )}
            <div style={{ ...S.statRow, borderBottom: 'none' }}>
              <span style={S.statLabel}>
                {activeView === 'eom' ? 'Scheduled – Unbudgeted (month-end)' : 'Scheduled – Unbudgeted'}
              </span>
              <span style={S.mono}>{fmtSubtract$(displayUncoveredScheduled)}</span>
            </div>
          </div>
        )}
      </section>

      <section>
        <div style={S.sectionHeader}>
          <div>
            <div style={S.eyebrow}>Cash</div>
            <h2 style={S.h2}>Accounts</h2>
          </div>
        </div>

        {data.cashAccounts.length === 0 ? (
          <div style={{ ...S.empty, marginTop: 14 }}>No on-budget cash accounts yet.</div>
        ) : (
          <div style={S.table}>
            <div style={S.summaryRow}>
              <div style={S.name}>Total cash accounts</div>
              <div style={{ ...S.mono, textAlign: 'right' }}>{fmt$(data.cashBalanceCents)}</div>
            </div>
            {data.cashAccounts.map((account, idx) => (
              <div
                key={account.id}
                style={{
                  ...S.row,
                  borderBottom: idx === data.cashAccounts.length - 1 ? 'none' : S.row.borderBottom,
                }}
              >
                <div>
                  <div style={S.name}>{account.name}</div>
                  <div style={S.meta}>{account.subtype}</div>
                </div>
                <div style={{ ...S.mono, textAlign: 'right' }}>{fmt$(account.balanceCents)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={S.sectionHeader}>
          <div>
            <div style={S.eyebrow}>Reserved</div>
            <h2 style={S.h2}>Budget Balances</h2>
          </div>
        </div>

        {data.reservedCategories.length === 0 ? (
          <div style={{ ...S.empty, marginTop: 14 }}>No positive category reserves yet.</div>
        ) : (
          <div style={S.table}>
            <div style={S.summaryRow}>
              <div style={S.name}>Total Reserved</div>
              <div style={{ ...S.mono, textAlign: 'right' }}>{fmt$(data.reservedEnvelopeCents)}</div>
            </div>
            {data.reservedCategories.map((cat, idx) => (
              <div
                key={cat.id}
                style={{
                  ...S.row,
                  borderBottom: idx === data.reservedCategories.length - 1 ? 'none' : S.row.borderBottom,
                }}
              >
                <div>
                  <div style={S.name}>{cat.name}</div>
                  <div style={S.meta}>{cat.groupName}</div>
                </div>
                <div style={{ ...S.mono, textAlign: 'right' }}>{fmt$(cat.availableCents)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
