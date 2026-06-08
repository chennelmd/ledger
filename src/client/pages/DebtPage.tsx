import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ─── types ────────────────────────────────────────────────────────────────────

interface DebtAccount {
  id: string;
  name: string;
  subtype: string;
  isRevolving: boolean | null;
  paysInFull: boolean;
  owedCents: number;
  creditLimitCents: number | null;
  apr: number | null;
  standardApr: number | null;
  promoEndDate: string | null;
  minPaymentCents: number | null;
  statementDay: number | null;
  dueDay: number | null;
  debtCategoryId: string | null;
  debtCategoryName: string | null;
  monthlyPaymentCents: number;
}

interface DebtResponse {
  month: string;
  accounts: DebtAccount[];
  totalDebtCents: number;
  totalMonthlyPaymentCents: number;
}

interface PayoffResult {
  months: number;
  interestCents: number;
  monthlyInterestCents: number;
}

interface PromoPayoff {
  promoMonthsLeft: number;
  balanceAtPromoEnd: number;        // cents remaining when promo expires
  minPaymentToClearInPromo: number; // monthly payment to clear balance before promo ends (cents)
  isOnTrack: boolean;
  totalMonths: number | null;       // null = payment won't cover standard rate interest
  totalInterestCents: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtPct = (rate: number) => `${(rate * 100).toFixed(2)}%`;

function payoffDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const SUBTYPE_PLURAL: Record<string, string> = {
  credit_card: 'Credit Cards',
  heloc: 'HELOCs',
  mortgage: 'Mortgages',
  student_loan: 'Student Loans',
  tax_debt: 'Tax Debt',
  auto_loan: 'Auto Loans',
  personal_loan: 'Personal Loans',
  retirement_loan: 'Retirement Loans',
};

function subtypeLabel(s: string) {
  return (
    ({
      credit_card: 'Credit Card',
      heloc: 'HELOC',
      mortgage: 'Mortgage',
      student_loan: 'Student Loan',
      tax_debt: 'Tax Debt',
      auto_loan: 'Auto Loan',
      personal_loan: 'Personal Loan',
      retirement_loan: 'Retirement Loan',
    } as Record<string, string>)[s] ?? s
  );
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function computePayoff(
  owedCents: number,
  apr: number | null,
  paymentCents: number
): PayoffResult | null {
  if (owedCents <= 0) return { months: 0, interestCents: 0, monthlyInterestCents: 0 };
  if (paymentCents <= 0) return null;
  if (!apr || apr === 0) {
    return {
      months: Math.ceil(owedCents / paymentCents),
      interestCents: 0,
      monthlyInterestCents: 0,
    };
  }
  const r = apr / 12;
  const monthlyInterestCents = Math.round(owedCents * r);
  if (paymentCents <= monthlyInterestCents) return null;
  const months = Math.ceil(
    -Math.log(1 - (r * owedCents) / paymentCents) / Math.log(1 + r)
  );
  // Simulate payoff to get exact total interest — the closed-form PMT*months−P
  // overstates because the final payment is partial, not a full PMT.
  let bal = owedCents;
  let totalInterestCents = 0;
  for (let i = 0; i < months; i++) {
    const interest = Math.round(bal * r);
    totalInterestCents += interest;
    bal = bal + interest - paymentCents;
    if (bal <= 0) break;
  }
  return {
    months,
    interestCents: Math.max(0, totalInterestCents),
    monthlyInterestCents,
  };
}

function computePromoPayoff(
  owedCents: number,
  promoApr: number | null,
  standardApr: number,
  promoEndDate: string,
  paymentCents: number,
): PromoPayoff | null {
  if (owedCents <= 0 || paymentCents <= 0) return null;

  const now = new Date();
  const end = new Date(promoEndDate + 'T12:00:00');
  // Subtract 1 when the promo-end day-of-month has already passed this month —
  // e.g. today May 28, end June 1 → 1 raw month but only 4 days left → 0 full cycles.
  const promoMonthsLeft = Math.max(0,
    (end.getFullYear() - now.getFullYear()) * 12 +
    (end.getMonth() - now.getMonth()) +
    (end.getDate() < now.getDate() ? -1 : 0),
  );

  const promoR = (promoApr ?? 0) / 12;

  // Payment needed to clear during promo (amortization formula, or simple division at 0%)
  let minPaymentToClearInPromo: number;
  if (promoMonthsLeft <= 0) {
    minPaymentToClearInPromo = owedCents;
  } else if (promoR === 0) {
    minPaymentToClearInPromo = Math.ceil(owedCents / promoMonthsLeft);
  } else {
    minPaymentToClearInPromo = Math.ceil(
      (owedCents * promoR) / (1 - Math.pow(1 + promoR, -promoMonthsLeft)),
    );
  }

  // Phase 1: simulate payments at promo APR for promoMonthsLeft months
  let balance = owedCents;
  let totalInterest = 0;
  for (let i = 0; i < promoMonthsLeft; i++) {
    const interest = Math.round(balance * promoR);
    totalInterest += interest;
    balance = balance + interest - paymentCents;
    if (balance <= 0) {
      return {
        promoMonthsLeft,
        balanceAtPromoEnd: 0,
        minPaymentToClearInPromo,
        isOnTrack: true,
        totalMonths: i + 1,
        totalInterestCents: Math.max(0, totalInterest),
      };
    }
  }

  const balanceAtPromoEnd = Math.max(0, balance);
  const isOnTrack = paymentCents >= minPaymentToClearInPromo;

  if (balanceAtPromoEnd <= 0) {
    return { promoMonthsLeft, balanceAtPromoEnd: 0, minPaymentToClearInPromo, isOnTrack: true, totalMonths: promoMonthsLeft, totalInterestCents: Math.max(0, totalInterest) };
  }

  // Phase 2: standard rate for remaining balance
  const stdR = standardApr / 12;
  if (stdR <= 0) {
    return {
      promoMonthsLeft, balanceAtPromoEnd, minPaymentToClearInPromo, isOnTrack,
      totalMonths: promoMonthsLeft + Math.ceil(balanceAtPromoEnd / paymentCents),
      totalInterestCents: Math.max(0, totalInterest),
    };
  }

  const monthlyStdInterest = Math.round(balanceAtPromoEnd * stdR);
  if (paymentCents <= monthlyStdInterest) {
    return { promoMonthsLeft, balanceAtPromoEnd, minPaymentToClearInPromo, isOnTrack, totalMonths: null, totalInterestCents: totalInterest };
  }

  const stdMonths = Math.ceil(-Math.log(1 - (stdR * balanceAtPromoEnd) / paymentCents) / Math.log(1 + stdR));
  // Simulate phase-2 payoff for exact interest (same reason as computePayoff — final payment is partial).
  let bal2 = balanceAtPromoEnd;
  let stdInterest = 0;
  for (let i = 0; i < stdMonths; i++) {
    const interest = Math.round(bal2 * stdR);
    stdInterest += interest;
    bal2 = bal2 + interest - paymentCents;
    if (bal2 <= 0) break;
  }
  stdInterest = Math.max(0, stdInterest);

  return {
    promoMonthsLeft,
    balanceAtPromoEnd,
    minPaymentToClearInPromo,
    isOnTrack,
    totalMonths: promoMonthsLeft + stdMonths,
    totalInterestCents: Math.max(0, totalInterest + stdInterest),
  };
}

// ─── api ──────────────────────────────────────────────────────────────────────

async function fetchDebt(month: string): Promise<DebtResponse> {
  const res = await fetch(`/api/dashboard/debt?month=${month}`);
  if (!res.ok) throw new Error('failed to fetch debt');
  return res.json();
}

async function putBudgetAssignment(
  month: string,
  categoryId: string,
  assignedCents: number
): Promise<unknown> {
  const res = await fetch(`/api/budget/${month}/${categoryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedCents }),
  });
  if (!res.ok) throw new Error('failed to save');
  return res.json();
}

// ─── Tip component ────────────────────────────────────────────────────────────

function Tip({ content }: { content: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: '1px solid #A8A29E',
          color: '#78716C',
          fontSize: 9,
          fontWeight: 700,
          cursor: 'default',
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        ?
      </span>
      {visible && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 7px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1C1917',
            color: '#FBF8F1',
            padding: '9px 12px',
            fontSize: 11.5,
            lineHeight: 1.6,
            width: 240,
            zIndex: 200,
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          {content}
        </div>
      )}
    </span>
  );
}

// ─── UtilizationBar ──────────────────────────────────────────────────────────

function UtilizationBar({
  owedCents,
  creditLimitCents,
}: {
  owedCents: number;
  creditLimitCents: number;
}) {
  const pct = Math.min(100, (owedCents / creditLimitCents) * 100);
  const barColor = pct >= 75 ? '#B91C1C' : pct >= 30 ? '#B45309' : '#365142';
  const filledBlocks = Math.round((pct / 100) * 15);

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#78716C',
          letterSpacing: '0.02em',
          marginBottom: 4,
        }}
      >
        <span style={{ color: barColor }}>{'█'.repeat(filledBlocks)}</span>
        <span style={{ color: '#D6CFC6' }}>{'░'.repeat(15 - filledBlocks)}</span>
        {'  '}
        {fmt$(owedCents)} of {fmt$(creditLimitCents)} limit{'  '}
        <span style={{ color: barColor }}>({pct.toFixed(0)}%)</span>
      </div>
      <div style={{ background: '#E7DFD0', height: 4, borderRadius: 2 }}>
        <div
          style={{
            background: barColor,
            height: 4,
            borderRadius: 2,
            width: `${pct}%`,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

// ─── PaymentInput ─────────────────────────────────────────────────────────────

function PaymentInput({
  month,
  account,
  localPaymentCents,
  onLocalChange,
}: {
  month: string;
  account: DebtAccount;
  localPaymentCents: number;
  onLocalChange: (cents: number) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: (cents: number) =>
      putBudgetAssignment(month, account.debtCategoryId!, cents),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debt'] }),
  });

  if (!account.debtCategoryId) {
    return (
      <div
        style={{
          color: '#A8A29E',
          fontSize: 12,
          fontStyle: 'italic',
          paddingTop: 4,
        }}
      >
        No debt category linked
      </div>
    );
  }

  function startEdit() {
    setDraft(localPaymentCents === 0 ? '' : (localPaymentCents / 100).toFixed(2));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit() {
    const cents = Math.round(parseFloat(draft || '0') * 100);
    const safeCents = isNaN(cents) ? 0 : cents;
    onLocalChange(safeCents);
    if (!isNaN(cents) && cents !== account.monthlyPaymentCents) {
      mutation.mutate(cents);
    }
    setEditing(false);
  }

  const belowMin =
    account.minPaymentCents !== null &&
    account.minPaymentCents > 0 &&
    localPaymentCents > 0 &&
    localPaymentCents < account.minPaymentCents;

  return (
    <div>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const cents = Math.round(parseFloat(e.target.value || '0') * 100);
            if (!isNaN(cents)) onLocalChange(cents);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          style={{
            border: '1px solid #1C1917',
            background: '#FFFEF9',
            fontFamily: "'JetBrains Mono', monospace",
            fontVariantNumeric: 'tabular-nums',
            fontSize: 14,
            width: '100%',
            padding: '7px 9px',
            boxSizing: 'border-box',
            outline: 'none',
            color: '#1C1917',
          }}
        />
      ) : (
        <button
          onClick={startEdit}
          title="Click to edit"
          style={{
            background: 'none',
            border: '1px solid #E7DFD0',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            fontVariantNumeric: 'tabular-nums',
            fontSize: 14,
            textAlign: 'left',
            width: '100%',
            padding: '7px 9px',
            color: localPaymentCents === 0 ? '#A8A29E' : '#1C1917',
          }}
        >
          {mutation.isPending
            ? 'Saving…'
            : localPaymentCents === 0
            ? '—'
            : fmt$(localPaymentCents)}
        </button>
      )}
      {belowMin && (
        <div
          style={{
            marginTop: 5,
            fontSize: 11,
            color: '#B45309',
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            padding: '3px 7px',
          }}
        >
          Below minimum payment
        </div>
      )}
    </div>
  );
}

// ─── AccountCard ──────────────────────────────────────────────────────────────

function AccountCard({ account, month }: { account: DebtAccount; month: string }) {
  const [localPaymentCents, setLocalPaymentCents] = useState(account.monthlyPaymentCents);

  const payoff = useMemo(
    () => computePayoff(account.owedCents, account.apr, localPaymentCents),
    [account.owedCents, account.apr, localPaymentCents]
  );

  // Two-phase payoff for promotional accounts: promo-rate period → standard-rate period.
  const promoPayoff = useMemo(() => {
    if (!account.promoEndDate || account.standardApr === null) return null;
    if (new Date(account.promoEndDate + 'T12:00:00') <= new Date()) return null;
    if (localPaymentCents <= 0) return null;
    return computePromoPayoff(
      account.owedCents, account.apr, account.standardApr,
      account.promoEndDate, localPaymentCents,
    );
  }, [account.owedCents, account.apr, account.standardApr, account.promoEndDate, localPaymentCents]);

  const hasActivePromo = account.promoEndDate !== null && account.standardApr !== null &&
    new Date((account.promoEndDate ?? '') + 'T12:00:00') > new Date();

  const monoStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums',
  };

  const colLabelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#78716C',
    marginBottom: 10,
  };

  const detailLabelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#78716C',
    marginBottom: 2,
    display: 'flex',
    alignItems: 'center',
  };

  const detailValueStyle: React.CSSProperties = {
    ...monoStyle,
    fontSize: 13.5,
    color: '#1C1917',
    marginBottom: 10,
  };

  const warningStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#B45309',
    background: '#FFFBEB',
    border: '1px solid #FDE68A',
    padding: '6px 10px',
    marginTop: 4,
  };

  const infoStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#78716C',
    fontStyle: 'italic',
    marginTop: 4,
  };

  const principalPaidCents =
    payoff && payoff.monthlyInterestCents !== undefined
      ? Math.max(0, localPaymentCents - payoff.monthlyInterestCents)
      : null;

  return (
    <div
      style={{
        border: '1px solid #E7DFD0',
        background: '#FBF8F1',
        marginBottom: 20,
        padding: 24,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 20,
            fontWeight: 500,
            color: '#1C1917',
            letterSpacing: '-0.01em',
          }}
        >
          {account.name}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#78716C',
            background: '#EDE7DC',
            border: '1px solid #D6CFC6',
            padding: '2px 8px',
          }}
        >
          {subtypeLabel(account.subtype)}
        </span>
        {account.paysInFull && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#365142',
              background: '#E6F0EC',
              border: '1px solid #A7C4B5',
              padding: '2px 8px',
            }}
          >
            ✓ Paid in Full Monthly
          </span>
        )}
      </div>

      {/* Balance */}
      <div
        style={{
          ...monoStyle,
          fontSize: 32,
          fontWeight: 600,
          color: '#1C1917',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {fmt$(account.owedCents)}
      </div>

      {/* Utilization bar */}
      {account.creditLimitCents !== null && account.creditLimitCents > 0 && (
        <UtilizationBar
          owedCents={account.owedCents}
          creditLimitCents={account.creditLimitCents}
        />
      )}

      {/* Three-column details */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 24,
          marginTop: 24,
          paddingTop: 20,
          borderTop: '1px solid #E7DFD0',
        }}
      >
        {/* Column 1 — Loan Info */}
        <div>
          <div style={colLabelStyle}>Loan Info</div>

          <div style={detailLabelStyle}>
            APR
            <Tip content="The Annual Percentage Rate determines how much interest accrues each month. Add it in Accounts to see payoff projections." />
          </div>
          {account.apr !== null ? (
            <div style={detailValueStyle}>{fmtPct(account.apr)}</div>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: '#A8A29E',
                fontStyle: 'italic',
                marginBottom: 10,
              }}
            >
              Not set — add in Accounts
            </div>
          )}

          {account.standardApr !== null && account.promoEndDate !== null && (
            <div
              style={{
                fontSize: 11,
                color: hasActivePromo ? '#92400E' : '#78716C',
                background: hasActivePromo ? '#FFFBEB' : '#F5EFE6',
                border: hasActivePromo ? '1px solid #FDE68A' : '1px solid #E7DFD0',
                padding: '4px 8px',
                marginBottom: 10,
              }}
            >
              Promo: {fmtPct(account.apr ?? 0)} → {fmtPct(account.standardApr)} after{' '}
              {new Date(account.promoEndDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
              {promoPayoff && promoPayoff.promoMonthsLeft > 0 && (
                <> · <strong>{promoPayoff.promoMonthsLeft} month{promoPayoff.promoMonthsLeft !== 1 ? 's' : ''} left</strong></>
              )}
              {!hasActivePromo && <> · expired</>}
            </div>
          )}

          <div style={detailLabelStyle}>Min Payment</div>
          <div style={detailValueStyle}>
            {account.minPaymentCents !== null ? fmt$(account.minPaymentCents) : '—'}
          </div>

          <div style={detailLabelStyle}>Due Day</div>
          <div style={detailValueStyle}>
            {account.dueDay !== null ? ordinal(account.dueDay) : '—'}
          </div>
        </div>

        {/* Column 2 — Monthly Payment */}
        <div>
          <div style={colLabelStyle}>
            Monthly Payment
          </div>
          <div style={{ ...detailLabelStyle, marginBottom: 8 }}>
            Budgeted / month
            <Tip content="How much you've set aside for this debt in the budget. Changing this updates your budget assignment for the current month and recalculates the payoff timeline instantly." />
          </div>
          <PaymentInput
            month={month}
            account={account}
            localPaymentCents={localPaymentCents}
            onLocalChange={setLocalPaymentCents}
          />
        </div>

        {/* Column 3 — Payoff Projection */}
        <div>
          <div style={colLabelStyle}>Payoff Projection</div>

          {account.paysInFull ? (
            <div style={{ fontSize: 12, color: '#365142', background: '#E6F0EC', border: '1px solid #A7C4B5', padding: '8px 10px', lineHeight: 1.5 }}>
              This card is paid in full each month — no interest cost and no payoff timeline needed.
            </div>
          ) : localPaymentCents <= 0 ? (
            <div style={infoStyle}>Set a monthly payment to see payoff timeline</div>
          ) : promoPayoff ? (
            // Two-phase projection for active promotional accounts
            <>
              <div style={detailLabelStyle}>
                Monthly interest (promo)
                <Tip content="Interest accruing now at the promotional rate. After the promo expires, this jumps to the standard APR." />
              </div>
              <div style={detailValueStyle}>
                {fmt$(payoff?.monthlyInterestCents ?? 0)}/mo
              </div>

              <div style={detailLabelStyle}>
                Principal paid
                <Tip content="The portion of your payment that actually reduces the balance: Monthly Payment − Monthly Interest." />
              </div>
              <div style={detailValueStyle}>
                {principalPaidCents !== null ? `${fmt$(principalPaidCents)}/mo` : '—'}
              </div>

              <div style={detailLabelStyle}>
                To clear before promo ends
                <Tip content="The minimum monthly payment required to pay off this balance before the promotional rate expires. If you pay less, the remaining balance switches to the standard (higher) APR." />
              </div>
              <div style={{ ...detailValueStyle, color: promoPayoff.isOnTrack ? '#365142' : '#B45309' }}>
                {fmt$(promoPayoff.minPaymentToClearInPromo)}/mo
                {promoPayoff.isOnTrack && <span style={{ fontSize: 11, marginLeft: 6 }}>✓ on track</span>}
              </div>

              {!promoPayoff.isOnTrack && promoPayoff.balanceAtPromoEnd > 0 && (
                <div style={{ ...warningStyle, marginBottom: 10 }}>
                  {fmt$(promoPayoff.balanceAtPromoEnd)} remaining at promo end — then {fmtPct(account.standardApr!)} APR applies
                </div>
              )}

              <div style={detailLabelStyle}>
                Paid off in
                <Tip content="Total months to full payoff using a two-phase calculation: payments at the promo rate until expiry, then at the standard rate for the remaining balance." />
              </div>
              {promoPayoff.totalMonths === null ? (
                <div style={warningStyle}>Payment won't cover standard rate interest — increase budget</div>
              ) : (
                <div style={{ ...detailValueStyle, color: '#365142' }}>
                  {promoPayoff.totalMonths === 0
                    ? 'Already paid'
                    : `${promoPayoff.totalMonths} month${promoPayoff.totalMonths === 1 ? '' : 's'} · ${payoffDate(promoPayoff.totalMonths)}`}
                </div>
              )}

              <div style={detailLabelStyle}>
                Total interest
                <Tip content="Combined interest across both phases. If paid off during the promo period, this is $0. Otherwise it includes the interest on the balance remaining after the promo rate expires." />
              </div>
              <div style={{ ...detailValueStyle, color: promoPayoff.totalInterestCents > 0 ? '#7A1F2B' : '#365142' }}>
                {fmt$(promoPayoff.totalInterestCents)}
              </div>
            </>
          ) : !account.apr && account.apr !== 0 ? (
            <div style={infoStyle}>Add APR to see interest breakdown</div>
          ) : payoff === null ? (
            <div style={warningStyle}>
              Payment doesn't cover interest — increase your monthly budget
            </div>
          ) : (
            <>
              <div style={detailLabelStyle}>
                Monthly interest
                <Tip content="Estimated interest added each month: balance × (APR ÷ 12). This is the portion of your payment that goes to the lender, not toward reducing your balance." />
              </div>
              <div style={detailValueStyle}>
                {fmt$(payoff.monthlyInterestCents)}/mo
              </div>

              <div style={detailLabelStyle}>
                Principal paid
                <Tip content="The portion of your payment that actually reduces the balance: Monthly Payment − Monthly Interest." />
              </div>
              <div style={detailValueStyle}>
                {principalPaidCents !== null ? `${fmt$(principalPaidCents)}/mo` : '—'}
              </div>

              <div style={detailLabelStyle}>
                Paid off in
                <Tip content="How long until this debt is fully paid off at the current monthly payment, accounting for compound interest (standard amortization formula)." />
              </div>
              <div style={{ ...detailValueStyle, color: '#365142' }}>
                {payoff.months === 0
                  ? 'Already paid'
                  : `${payoff.months} month${payoff.months === 1 ? '' : 's'} · ${payoffDate(payoff.months)}`}
              </div>

              <div style={detailLabelStyle}>
                Total interest
                <Tip content="The total additional amount you'll pay beyond the current balance. Paying more each month reduces this significantly." />
              </div>
              <div
                style={{
                  ...detailValueStyle,
                  color: payoff.interestCents > 0 ? '#7A1F2B' : '#1C1917',
                }}
              >
                {fmt$(payoff.interestCents)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SummaryBar ───────────────────────────────────────────────────────────────

function SummaryBar({ data }: { data: DebtResponse }) {
  const monoStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums',
  };

  // Weighted average APR by owedCents
  const totalOwedWithApr = data.accounts.reduce(
    (s, a) => (a.apr !== null ? s + a.owedCents : s),
    0
  );
  const weightedApr =
    totalOwedWithApr > 0
      ? data.accounts.reduce(
          (s, a) => (a.apr !== null ? s + a.apr * a.owedCents : s),
          0
        ) / totalOwedWithApr
      : null;

  // Latest payoff date — use two-phase calculation for active promo accounts
  let debtFreeLabel = '—';
  let canCompute = true;
  let maxMonths = 0;
  const now = new Date();
  for (const acct of data.accounts) {
    if (acct.owedCents <= 0) continue;
    const isActivePromo =
      acct.promoEndDate !== null &&
      acct.standardApr !== null &&
      new Date((acct.promoEndDate ?? '') + 'T12:00:00') > now;

    let months: number | null;
    if (isActivePromo && acct.standardApr !== null && acct.promoEndDate !== null) {
      const pp = computePromoPayoff(acct.owedCents, acct.apr, acct.standardApr, acct.promoEndDate, acct.monthlyPaymentCents);
      months = pp?.totalMonths ?? null;
    } else {
      const p = computePayoff(acct.owedCents, acct.apr, acct.monthlyPaymentCents);
      months = p?.months ?? null;
    }

    if (months === null) { canCompute = false; break; }
    if (months > maxMonths) maxMonths = months;
  }
  if (canCompute && data.accounts.some((a) => a.owedCents > 0)) {
    debtFreeLabel = payoffDate(maxMonths);
  }

  const stats: Array<{
    label: string;
    value: string;
    tooltip: string;
    valueColor?: string;
  }> = [
    {
      label: 'Total Owed',
      value: fmt$(data.totalDebtCents),
      tooltip:
        'The current outstanding balance across all on-budget liability accounts.',
      valueColor: '#7A1F2B',
    },
    {
      label: 'Monthly Payment',
      value: fmt$(data.totalMonthlyPaymentCents),
      tooltip:
        "The total you've budgeted toward debt payments this month. Edit each card to change.",
    },
    {
      label: 'Avg APR',
      value: weightedApr !== null ? fmtPct(weightedApr) : '—',
      tooltip:
        'Weighted average Annual Percentage Rate across all debts. Higher APR debts cost more per dollar owed.',
    },
    {
      label: 'Debt-Free',
      value: debtFreeLabel,
      tooltip:
        'The month your last debt will be paid off, based on current monthly payments.',
      valueColor: debtFreeLabel !== '—' ? '#365142' : undefined,
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        border: '1px solid #E7DFD0',
        background: '#FBF8F1',
        marginBottom: 32,
      }}
    >
      {stats.map((stat, idx) => (
        <div
          key={stat.label}
          style={{
            padding: '18px 20px',
            borderRight: idx < stats.length - 1 ? '1px solid #E7DFD0' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#78716C',
              marginBottom: 8,
            }}
          >
            {stat.label}
            <Tip content={stat.tooltip} />
          </div>
          <div
            style={{
              ...monoStyle,
              fontSize: 22,
              fontWeight: 600,
              color: stat.valueColor ?? '#1C1917',
              letterSpacing: '-0.01em',
            }}
          >
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── TypeBreakdown ────────────────────────────────────────────────────────────

function TypeBreakdown({ data }: { data: DebtResponse }) {
  // Group total owed by account subtype
  const groups = new Map<string, number>();
  for (const acct of data.accounts) {
    if (acct.owedCents > 0) {
      groups.set(acct.subtype, (groups.get(acct.subtype) ?? 0) + acct.owedCents);
    }
  }

  const sorted = [...groups.entries()].sort(([, a], [, b]) => b - a);

  // Only render when there are 2+ distinct types — with a single type the
  // summary bar already shows the total, so the breakdown adds nothing.
  if (sorted.length < 2) return null;

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
      {sorted.map(([subtype, cents]) => (
        <div
          key={subtype}
          style={{
            flex: '1 1 140px',
            border: '1px solid #E7DFD0',
            background: '#FBF8F1',
            padding: '14px 18px',
          }}
        >
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#78716C',
            marginBottom: 6,
          }}>
            {SUBTYPE_PLURAL[subtype] ?? subtypeLabel(subtype)}
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontVariantNumeric: 'tabular-nums',
            fontSize: 20,
            fontWeight: 600,
            color: '#7A1F2B',
          }}>
            {fmt$(cents)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── DebtPage ─────────────────────────────────────────────────────────────────

export function DebtPage() {
  const month = currentMonth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['debt'],
    queryFn: () => fetchDebt(month),
  });

  if (isLoading) {
    return <p style={{ color: '#78716C' }}>Loading…</p>;
  }

  if (error) {
    return (
      <p style={{ color: '#7A1F2B' }}>Error: {(error as Error).message}</p>
    );
  }

  if (!data) return null;

  const hasAccounts = data.accounts.length > 0;

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 10.5,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#78716C',
            fontWeight: 600,
          }}
        >
          Dashboard
        </div>
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid #E7DFD0',
            margin: '10px 0 16px',
          }}
        />
        <h2
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 28,
            fontWeight: 500,
            margin: 0,
            letterSpacing: '-0.02em',
            color: '#1C1917',
          }}
        >
          Debt Payoff
        </h2>
        <p style={{ color: '#78716C', fontSize: 13.5, margin: '6px 0 0', lineHeight: 1.5 }}>
          Track balances, APRs, and projected payoff timelines for all your liability accounts.
        </p>
      </div>

      {/* Summary bar */}
      {hasAccounts && <SummaryBar data={data} />}

      {/* By-type breakdown — only shown when there are 2+ debt types */}
      {hasAccounts && <TypeBreakdown data={data} />}

      {/* Account cards */}
      {hasAccounts ? (
        data.accounts.map((account) => (
          <AccountCard key={account.id} account={account} month={month} />
        ))
      ) : (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: '#78716C',
            border: '1px solid #E7DFD0',
            background: '#FBF8F1',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          No debt accounts. Add a liability account in Accounts to track debt payoff.
        </div>
      )}
    </div>
  );
}
