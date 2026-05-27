import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface ReconcileStatus {
  clearedBalanceCents: number;
  clearedCount: number;
}

interface ReconcileResult {
  ok: boolean;
  adjustmentCents: number;
  adjustmentId: string | null;
}

interface AccountInfo {
  id: string;
  name: string;
}

async function fetchStatus(accountId: string): Promise<ReconcileStatus> {
  const res = await fetch(`/api/accounts/${accountId}/reconcile`);
  if (!res.ok) throw new Error('Failed to load cleared balance');
  return res.json();
}

async function postReconcile(accountId: string, statementBalanceCents: number): Promise<ReconcileResult> {
  const res = await fetch(`/api/accounts/${accountId}/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statementBalanceCents }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Reconciliation failed');
  }
  return res.json();
}

const fmt$ = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(28, 25, 23, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 24,
  },
  modal: {
    background: '#FFFEF9',
    border: '1px solid #E7DFD0',
    width: '100%',
    maxWidth: 400,
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: '24px 28px 0',
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 22,
    fontWeight: 500,
    letterSpacing: '-0.02em',
    color: '#1C1917',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#78716C',
    padding: 4,
    fontSize: 18,
    lineHeight: 1,
    fontFamily: 'inherit',
  },
  body: { padding: '20px 28px 28px' },
  accountName: { fontSize: 12, color: '#78716C', marginBottom: 18 },
  row: { marginBottom: 16 },
  label: {
    display: 'block',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#78716C',
    marginBottom: 5,
  },
  value: {
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: 15,
    color: '#1C1917',
  },
  subtext: { fontSize: 11.5, color: '#A8A29E', marginTop: 3 },
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #E7DFD0',
    background: '#FFFEF9',
    padding: '8px 10px',
    fontSize: 13.5,
    color: '#1C1917',
    outline: 'none',
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums' as const,
  },
  diffBox: (balanced: boolean) => ({
    padding: '10px 12px',
    background: balanced ? '#F0F7EC' : '#FDF2F2',
    border: `1px solid ${balanced ? '#C8D8B8' : '#F0D0D3'}`,
    marginBottom: 16,
  }),
  diffLabel: (balanced: boolean) => ({
    fontSize: 10.5,
    fontWeight: 600 as const,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: balanced ? '#2D5016' : '#7A1F2B',
    marginBottom: 4,
  }),
  diffValue: (balanced: boolean) => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: 14,
    color: balanced ? '#2D5016' : '#7A1F2B',
  }),
  diffNote: { fontSize: 11.5, color: '#7A1F2B', marginTop: 4 },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 20,
    borderTop: '1px solid #F0EADD',
    marginTop: 8,
  },
  btnCancel: {
    background: 'none',
    border: '1px solid #E7DFD0',
    padding: '8px 20px',
    fontSize: 13,
    color: '#78716C',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnSubmit: (enabled: boolean) => ({
    background: '#1C1917',
    border: 'none',
    padding: '8px 20px',
    fontSize: 13,
    color: '#FBF8F1',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit',
    opacity: enabled ? 1 : 0.45,
  }),
  errorMsg: { marginTop: 10, fontSize: 12.5, color: '#7A1F2B' },
  successText: { fontSize: 13.5, color: '#1C1917', lineHeight: 1.6, margin: '0 0 20px' },
};

interface Props {
  account: AccountInfo;
  onClose: () => void;
}

export function ReconcileModal({ account, onClose }: Props) {
  const qc = useQueryClient();
  const [statement, setStatement] = useState('');
  const [done, setDone] = useState<ReconcileResult | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['reconcile-status', account.id],
    queryFn: () => fetchStatus(account.id),
  });

  const mutation = useMutation({
    mutationFn: (cents: number) => postReconcile(account.id, cents),
    onSuccess: (result) => {
      setDone(result);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const cleared = status?.clearedBalanceCents ?? 0;
  const statementCents = Math.round(parseFloat(statement || '0') * 100);
  const diff = statementCents - cleared;
  const hasInput = statement.trim() !== '';
  const isBalanced = hasInput && diff === 0;

  // ── Success screen ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={S.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={S.modal}>
          <div style={S.header}>
            <h2 style={S.title}>Reconciled</h2>
            <button style={S.closeBtn} onClick={onClose}>×</button>
          </div>
          <div style={S.body}>
            {done.adjustmentCents === 0 ? (
              <p style={S.successText}>
                Cleared balance matched your statement.{' '}
                {status && `All ${status.clearedCount} cleared transaction${status.clearedCount !== 1 ? 's' : ''} are now locked.`}
              </p>
            ) : (
              <p style={S.successText}>
                A {fmt$(Math.abs(done.adjustmentCents))} adjustment was posted to close the gap.
                All cleared transactions are now locked.
              </p>
            )}
            <div style={S.footer}>
              <button style={S.btnSubmit(true)} onClick={onClose}>Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Entry screen ────────────────────────────────────────────────────────────
  return (
    <div style={S.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>
        <div style={S.header}>
          <h2 style={S.title}>Reconcile</h2>
          <button style={S.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={S.body}>
          <form onSubmit={(e) => { e.preventDefault(); if (hasInput) mutation.mutate(statementCents); }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }} disabled={mutation.isPending}>

              <div style={S.accountName}>{account.name}</div>

              <div style={S.row}>
                <div style={S.label}>Cleared balance</div>
                <div style={S.value}>{isLoading ? '…' : fmt$(cleared)}</div>
                {status && (
                  <div style={S.subtext}>
                    {status.clearedCount} cleared transaction{status.clearedCount !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              <div style={S.row}>
                <label style={S.label} htmlFor="recon-statement">Statement balance</label>
                <input
                  id="recon-statement"
                  style={S.input}
                  type="number"
                  step="0.01"
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  required
                />
              </div>

              {hasInput && (
                <div style={S.diffBox(isBalanced)}>
                  <div style={S.diffLabel(isBalanced)}>Difference</div>
                  <div style={S.diffValue(isBalanced)}>{fmt$(diff)}</div>
                  {!isBalanced && (
                    <div style={S.diffNote}>
                      A {fmt$(Math.abs(diff))} adjustment transaction will be created.
                    </div>
                  )}
                </div>
              )}

              {mutation.isError && (
                <p style={S.errorMsg}>{(mutation.error as Error).message}</p>
              )}

              <div style={S.footer}>
                <button type="button" style={S.btnCancel} onClick={onClose}>Cancel</button>
                <button type="submit" style={S.btnSubmit(hasInput)} disabled={!hasInput}>
                  {mutation.isPending ? 'Reconciling…' : 'Reconcile'}
                </button>
              </div>

            </fieldset>
          </form>
        </div>
      </div>
    </div>
  );
}
