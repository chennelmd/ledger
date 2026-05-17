import { useQuery } from '@tanstack/react-query';

type FreeCashResponse = {
  month: string;
  cashBalanceCents: number;
  reservedEnvelopeCents: number;
  scheduledOutflowsCents: number;
  uncoveredScheduledOutflowsCents: number;
  freeCashCents: number;
  cashAccounts: Array<{
    id: string;
    name: string;
    subtype: string;
    balanceCents: number;
  }>;
  reservedCategories: Array<{
    id: string;
    name: string;
    groupName: string;
    availableCents: number;
  }>;
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
  return new Date(year, monthIndex - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
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

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'free-cash'],
    queryFn: fetchFreeCash,
  });

  if (isLoading) return <p style={{ color: '#78716C' }}>Loading...</p>;
  if (error) return <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>;
  if (!data) return null;

  const freeCashColor = data.freeCashCents < 0 ? '#7A1F2B' : '#365142';

  return (
    <div>
      <section style={S.hero}>
        <div>
          <div style={S.eyebrow}>Vol. 1 · Free Cash</div>
          <hr style={S.rule} />
          <div style={{ color: '#78716C', fontSize: 12.5 }}>{monthLabel(data.month)}</div>
          <div style={{ ...S.heroNumber, color: freeCashColor }}>
            {fmt$(data.freeCashCents)}
          </div>
          <p style={S.subtitle}>Right now</p>
        </div>

        <div style={S.stats}>
          <div style={S.statRow}>
            <span style={S.statLabel}>Cash accounts</span>
            <span style={S.mono}>{fmt$(data.cashBalanceCents)}</span>
          </div>
          <div style={S.statRow}>
            <span style={S.statLabel}>Reserves</span>
            <span style={S.mono}>{fmtSubtract$(data.reservedEnvelopeCents)}</span>
          </div>
          <div style={{ ...S.statRow, borderBottom: 'none' }}>
            <span style={S.statLabel}>Scheduled outflows</span>
            <span style={S.mono}>{fmtSubtract$(data.uncoveredScheduledOutflowsCents)}</span>
          </div>
        </div>
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
            <h2 style={S.h2}>Category Balances</h2>
          </div>
        </div>

        {data.reservedCategories.length === 0 ? (
          <div style={{ ...S.empty, marginTop: 14 }}>No positive category reserves yet.</div>
        ) : (
          <div style={S.table}>
            <div style={S.summaryRow}>
              <div style={S.name}>Total reserves</div>
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
