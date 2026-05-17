import { useState } from 'react';
import { AccountsPage } from './pages/AccountsPage.js';
import { BudgetPage } from './pages/BudgetPage.js';
import { LedgerPage } from './pages/LedgerPage.js';

type View = 'accounts' | 'budget' | 'ledger';

const NAV: { id: View; label: string }[] = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'budget',   label: 'Budget' },
  { id: 'ledger',   label: 'Ledger' },
];

export function App() {
  const [view, setView] = useState<View>('accounts');
  const [ledgerAccountId, setLedgerAccountId] = useState('');

  function navigateToLedger(accountId: string) {
    setLedgerAccountId(accountId);
    setView('ledger');
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px 80px' }}>
      {/* Masthead */}
      <header style={{ marginBottom: 0 }}>
        <div style={{
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#78716C',
          fontWeight: 500,
        }}>
          Vol. 1 · Issue 01
        </div>
        <h1 style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 36,
          fontWeight: 500,
          margin: '4px 0 0',
          letterSpacing: '-0.02em',
        }}>
          The Ledger
        </h1>
      </header>

      {/* Tab nav */}
      <nav style={{
        display: 'flex',
        gap: 0,
        marginTop: 20,
        borderBottom: '1px solid #1C1917',
      }}>
        {NAV.map(({ id, label }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid #1C1917' : '2px solid transparent',
                marginBottom: -1,
                padding: '8px 18px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: active ? '#1C1917' : '#78716C',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/* Page content */}
      <main style={{ paddingTop: 32 }}>
        {view === 'accounts' && <AccountsPage onNavigateToLedger={navigateToLedger} />}
        {view === 'budget'   && <BudgetPage />}
        {view === 'ledger'   && <LedgerPage initialAccountId={ledgerAccountId} />}
      </main>
    </div>
  );
}
