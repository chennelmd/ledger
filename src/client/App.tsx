import { useState } from 'react';
import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Home, LayoutGrid, CalendarClock, TrendingDown, Settings, Plus, HelpCircle,
} from 'lucide-react';
import { AccountsPage } from './pages/AccountsPage.js';
import { BudgetPage } from './pages/BudgetPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { DebtPage } from './pages/DebtPage.js';
import { HelpPage } from './pages/HelpPage.js';
import { LedgerPage } from './pages/LedgerPage.js';
import { SchedulesPage } from './pages/SchedulesPage.js';
import { AddTransactionModal } from './components/AddTransactionModal.js';
import type { Account } from '../db/schema.js';

type View = 'dashboard' | 'debt' | 'accounts' | 'budget' | 'ledger' | 'schedules' | 'help';
type AccountWithBalance = Account & { balanceCents: number };
type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

async function fetchAccounts(): Promise<AccountWithBalance[]> {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('failed to fetch accounts');
  return res.json();
}

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const C = {
  border: '1px solid #E7DFD0',
  muted: '#78716C',
  faint: '#A8A29E',
  sidebarBg: '#FAF7F2',
  activeBg: '#EDE9E0',
  red: '#B91C1C',
};

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 9.5,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: C.faint,
        padding: '0 8px',
        marginBottom: 3,
        fontWeight: 500,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function NavBtn({
  active, onClick, icon: Icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: Icon;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 8px',
        borderRadius: 6,
        fontSize: 13,
        color: active ? '#1C1917' : C.muted,
        fontWeight: active ? 500 : 400,
        background: active ? C.activeBg : hovered ? '#EDE9E066' : 'none',
        border: 'none',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        marginBottom: 1,
      }}
    >
      {Icon && <Icon size={14} strokeWidth={1.75} />}
      {children}
    </button>
  );
}

function AccountBtn({
  account, active, onClick,
}: {
  account: AccountWithBalance;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isLiability = account.type === 'liability';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 8px',
        borderRadius: 6,
        fontSize: 12.5,
        color: active ? '#1C1917' : C.muted,
        fontWeight: active ? 500 : 400,
        background: active ? C.activeBg : hovered ? '#EDE9E066' : 'none',
        border: 'none',
        width: '100%',
        cursor: 'pointer',
        fontFamily: 'inherit',
        marginBottom: 1,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {account.name}
      </span>
      <span style={{
        fontSize: 11,
        color: isLiability ? C.red : C.faint,
        marginLeft: 6,
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {fmt$(account.balanceCents)}
      </span>
    </button>
  );
}

export function App() {
  const [view, setView] = useState<View>('dashboard');
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [showAddTx, setShowAddTx] = useState(false);

  const { data: accounts = [] } = useQuery<AccountWithBalance[]>({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
  });

  const assets      = accounts.filter(a => a.type === 'asset');
  const liabilities = accounts.filter(a => a.type === 'liability');
  const tracking    = accounts.filter(a => a.type === 'tracking');

  function goLedger(accountId: string) {
    setLedgerAccountId(accountId);
    setView('ledger');
  }

  const isActiveLedger = (id: string) => view === 'ledger' && ledgerAccountId === id;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <nav style={{
        width: 220,
        flexShrink: 0,
        background: C.sidebarBg,
        borderRight: C.border,
        padding: '20px 12px',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}>

        {/* Brand */}
        <div style={{ padding: '0 6px', marginBottom: 18 }}>
          <h1 style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: '#1C1917',
            margin: '0 0 12px',
          }}>
            The Ledger
          </h1>
          <button
            onClick={() => setShowAddTx(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              padding: '7px 0',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              border: '1px solid #D4C9B8',
              background: 'white',
              color: '#1C1917',
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.02em',
            }}
          >
            <Plus size={13} strokeWidth={2} />
            Add transaction
          </button>
        </div>

        <NavGroup label="Overview">
          <NavBtn active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={Home}>
            Dashboard
          </NavBtn>
        </NavGroup>

        <NavGroup label="Planning">
          <NavBtn active={view === 'budget'} onClick={() => setView('budget')} icon={LayoutGrid}>
            Budget
          </NavBtn>
          <NavBtn active={view === 'schedules'} onClick={() => setView('schedules')} icon={CalendarClock}>
            Schedules
          </NavBtn>
        </NavGroup>

        {assets.length > 0 && (
          <NavGroup label="Assets">
            {assets.map(a => (
              <AccountBtn
                key={a.id}
                account={a}
                active={isActiveLedger(a.id)}
                onClick={() => goLedger(a.id)}
              />
            ))}
          </NavGroup>
        )}

        {liabilities.length > 0 && (
          <NavGroup label="Liabilities">
            {liabilities.map(a => (
              <AccountBtn
                key={a.id}
                account={a}
                active={isActiveLedger(a.id)}
                onClick={() => goLedger(a.id)}
              />
            ))}
          </NavGroup>
        )}

        {tracking.length > 0 && (
          <NavGroup label="Tracking">
            {tracking.map(a => (
              <AccountBtn
                key={a.id}
                account={a}
                active={isActiveLedger(a.id)}
                onClick={() => goLedger(a.id)}
              />
            ))}
          </NavGroup>
        )}

        {/* Footer */}
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: C.border }}>
          <NavBtn active={view === 'debt'} onClick={() => setView('debt')} icon={TrendingDown}>
            Debt payoff
          </NavBtn>
          <NavBtn active={view === 'accounts'} onClick={() => setView('accounts')} icon={Settings}>
            Manage accounts
          </NavBtn>
          <NavBtn active={view === 'help'} onClick={() => setView('help')} icon={HelpCircle}>
            Help
          </NavBtn>
        </div>

        <div style={{
          fontSize: 9,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: C.faint,
          padding: '10px 8px 0',
          opacity: 0.55,
        }}>
          Vol. 1 · Issue 01
        </div>
      </nav>

      {/* ── Main content ────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '40px 40px 80px', minWidth: 0 }}>
        {view === 'dashboard' && <DashboardPage />}
        {view === 'debt'      && <DebtPage />}
        {view === 'accounts'  && <AccountsPage onNavigateToLedger={goLedger} />}
        {view === 'budget'    && <BudgetPage />}
        {view === 'ledger'    && <LedgerPage key={ledgerAccountId} initialAccountId={ledgerAccountId} />}
        {view === 'schedules' && <SchedulesPage />}
        {view === 'help'      && <HelpPage />}
      </main>

      {showAddTx && <AddTransactionModal onClose={() => setShowAddTx(false)} />}
    </div>
  );
}
