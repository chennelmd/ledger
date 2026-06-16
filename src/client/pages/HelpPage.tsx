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
    margin: '12px 0 28px',
  },
  pageTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 32,
    fontWeight: 500,
    margin: '4px 0 0',
    letterSpacing: '-0.02em',
    color: '#1C1917',
  },
  section: {
    marginBottom: 52,
  },
  sectionNumber: {
    fontSize: 10.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: '#A8A29E',
    fontWeight: 600,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 22,
    fontWeight: 500,
    margin: '0 0 14px',
    color: '#1C1917',
  },
  body: {
    fontSize: 14,
    color: '#44403C',
    lineHeight: 1.7,
    maxWidth: 640,
    margin: '0 0 14px',
  },
  formulaCard: {
    background: '#FBF8F1',
    border: '1px solid #E7DFD0',
    padding: '16px 20px',
    marginBottom: 16,
    display: 'inline-block',
  },
  formulaRow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#1C1917',
    lineHeight: 1.9,
    display: 'flex',
    gap: 12,
    alignItems: 'baseline',
  },
  formulaOperator: {
    color: '#A8A29E',
    minWidth: 12,
    textAlign: 'right' as const,
  },
  formulaDivider: {
    border: 'none',
    borderTop: '1px solid #D6CFC6',
    margin: '8px 0',
  },
  formulaResult: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
    color: '#365142',
    lineHeight: 1.9,
    display: 'flex',
    gap: 12,
    alignItems: 'baseline',
  },
  termGrid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: '8px 20px',
    marginBottom: 14,
    maxWidth: 580,
  },
  term: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12.5,
    color: '#1C1917',
    fontWeight: 600,
    paddingTop: 1,
  },
  termDef: {
    fontSize: 13.5,
    color: '#44403C',
    lineHeight: 1.6,
  },
  callout: {
    background: '#F5EFE6',
    borderLeft: '3px solid #C5BDB5',
    padding: '10px 14px',
    fontSize: 13.5,
    color: '#44403C',
    lineHeight: 1.6,
    maxWidth: 580,
    marginBottom: 14,
  },
  stepList: {
    paddingLeft: 20,
    margin: '0 0 14px',
    maxWidth: 580,
  },
  stepItem: {
    fontSize: 13.5,
    color: '#44403C',
    lineHeight: 1.7,
    marginBottom: 4,
  },
};

export function HelpPage() {
  return (
    <div>
      <div style={S.eyebrow}>Vol. 1 · Reference</div>
      <hr style={S.rule} />
      <h1 style={S.pageTitle}>How This Works</h1>
      <p style={{ ...S.body, marginTop: 12, color: '#78716C' }}>
        A reference for understanding how the numbers are calculated and how to use each part of the app.
      </p>

      {/* ── 01 Unassigned Cash ─────────────────────────────────────── */}
      <section style={{ ...S.section, marginTop: 40 }}>
        <div style={S.sectionNumber}>01</div>
        <h2 style={S.sectionTitle}>Unassigned Cash</h2>

        <p style={S.body}>
          The headline number on the Dashboard. It answers: <em>"how much of my cash is truly free — not already spoken for by my budget or upcoming bills?"</em>
        </p>

        <div style={S.formulaCard}>
          <div style={S.formulaRow}><span style={S.formulaOperator}> </span><span>Cash Accounts</span></div>
          <div style={S.formulaRow}><span style={S.formulaOperator}>−</span><span>Reserved for Budget</span></div>
          <div style={S.formulaRow}><span style={S.formulaOperator}>−</span><span>Scheduled – Unbudgeted</span></div>
          <hr style={S.formulaDivider} />
          <div style={S.formulaResult}><span style={{ minWidth: 12 }}> </span><span>Unassigned Cash</span></div>
        </div>

        <div style={S.termGrid}>
          <div style={S.term}>Cash Accounts</div>
          <div style={S.termDef}>Live balance across all on-budget checking, savings, and cash accounts.</div>

          <div style={S.term}>Reserved for Budget</div>
          <div style={S.termDef}>
            The total of all positive category balances plus any debt payment amounts assigned this month that haven't been transferred yet.
            Money you've already assigned to envelopes is spoken for, even if not yet spent.
            Hover the Reserved card on the Dashboard to see a full breakdown by envelope.
          </div>

          <div style={S.term}>Scheduled – Unbudgeted</div>
          <div style={S.termDef}>Upcoming bills/income from the Schedules page that fall within the selected window and aren't already covered by a category reserve.</div>
        </div>

        <p style={{ ...S.body, fontWeight: 600, marginBottom: 6 }}>The three views:</p>
        <div style={S.termGrid}>
          <div style={S.term}>Right Now</div>
          <div style={S.termDef}>Deducts scheduled transactions due within the next 30 days from today. A rolling window — doesn't reset on the 1st.</div>

          <div style={S.term}>End of Month</div>
          <div style={S.termDef}>Deducts only scheduled transactions due by the last day of the current calendar month. Useful if you budget month-to-month.</div>

          <div style={S.term}>Per Account</div>
          <div style={S.termDef}>Splits the total unassigned cash proportionally across each cash account based on its share of the total cash balance.</div>
        </div>
      </section>

      {/* ── 02 Envelope Budgeting ─────────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>02</div>
        <h2 style={S.sectionTitle}>Envelope Budgeting</h2>

        <p style={S.body}>
          The core idea: every dollar you have is assigned to a category (an "envelope"). You decide in advance what each dollar is for. When you spend, you record it against a category, and that category's balance goes down.
        </p>

        <p style={S.body}>
          Each category tracks a running balance that carries over month to month:
        </p>

        <div style={S.formulaCard}>
          <div style={S.formulaRow}><span style={S.formulaOperator}> </span><span>Previous month balance</span></div>
          <div style={S.formulaRow}><span style={S.formulaOperator}>+</span><span>Assigned this month</span></div>
          <div style={S.formulaRow}><span style={S.formulaOperator}>+</span><span>Activity (spending is negative)</span></div>
          <hr style={S.formulaDivider} />
          <div style={S.formulaResult}><span style={{ minWidth: 12 }}> </span><span>Available</span></div>
        </div>

        <div style={S.termGrid}>
          <div style={S.term}>Assigned</div>
          <div style={S.termDef}>How much you budgeted to this category in a given month. Set this on the Budget page.</div>

          <div style={S.term}>Activity</div>
          <div style={S.termDef}>
            All categorized transactions posted to this category during the month. Spending is negative; refunds are positive.
            For split transactions, only the amount allocated to this category counts — not the full transaction total.
            Uncategorized splits are excluded entirely.
          </div>

          <div style={S.term}>Available</div>
          <div style={S.termDef}>The current balance of the envelope. If positive, that money is sitting in your accounts reserved for this purpose. If negative, you've overspent.</div>
        </div>

        <div style={S.callout}>
          The sum of all positive Available balances (plus unfunded debt payments) is what appears as <strong>Reserved for Budget</strong> on the Dashboard. It's money that's in your accounts but already earmarked.
        </div>
      </section>

      {/* ── 03 Budget Page ────────────────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>03</div>
        <h2 style={S.sectionTitle}>Budget Page</h2>

        <p style={S.body}>
          The Budget page shows all your categories organized into groups. Each row shows a category's Assigned, Activity, and Available for each month.
        </p>

        <p style={{ ...S.body, fontWeight: 600, marginBottom: 6 }}>How to use it:</p>
        <ol style={S.stepList}>
          <li style={S.stepItem}>At the start of each month, enter an amount in the <strong>Assigned</strong> column for each category you plan to spend from.</li>
          <li style={S.stepItem}>As transactions are recorded, <strong>Activity</strong> fills in automatically.</li>
          <li style={S.stepItem}>Watch the <strong>Available</strong> column — when it hits zero, the envelope is empty.</li>
          <li style={S.stepItem}>Positive balances roll over to next month automatically. If you overspent, the negative rolls over too (unless the category is set not to).</li>
        </ol>

        <div style={S.termGrid}>
          <div style={S.term}>Ready to Assign</div>
          <div style={S.termDef}>Shown at the top of the Budget page. The amount of cash in your accounts that hasn't been assigned to any category yet. Aim to get this to $0.00 by assigning every dollar a job.</div>

          <div style={S.term}>Goals</div>
          <div style={S.termDef}>Optional targets you can set per category. The small progress bar under the Available amount shows how close you are. Hover the bar to set or change the goal.</div>

          <div style={S.term}>Move to group</div>
          <div style={S.termDef}>Hover a category name and click the ⋯ button to move it to a different group. Useful for reorganizing without losing history.</div>

          <div style={S.term}>Hidden categories</div>
          <div style={S.termDef}>Categories or groups that have been hidden or deleted appear in a section at the bottom of the Budget page. You can restore them to their original group or move them to a new one.</div>

          <div style={S.term}>Debt categories</div>
          <div style={S.termDef}>Categories linked to a liability account (credit card) are managed on the Debt page, not here. They are hidden from the Budget view to keep it focused on spending decisions.</div>
        </div>
      </section>

      {/* ── 04 Accounts ───────────────────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>04</div>
        <h2 style={S.sectionTitle}>Accounts</h2>

        <p style={S.body}>
          Accounts come in three types. Understanding the difference matters for how balances flow into your budget and net worth.
        </p>

        <div style={S.termGrid}>
          <div style={S.term}>Asset</div>
          <div style={S.termDef}>On-budget. Checking, savings, cash — money you have and can spend. These balances feed into Unassigned Cash and Ready to Assign.</div>

          <div style={S.term}>Liability</div>
          <div style={S.termDef}>On-budget. Credit cards and other debts you're actively paying down. Each gets a linked debt category. Tracked on the Debt page.</div>

          <div style={S.term}>Tracking</div>
          <div style={S.termDef}>Off-budget. Home value, car value, mortgage balance, investments. Not included in your spendable cash, but counted in net worth.</div>
        </div>

        <div style={S.callout}>
          A mortgage should be set up as a <strong>Tracking</strong> account (subtype: Mortgage), not a Liability. This keeps the balance visible in net worth without creating a debt payment category. Your monthly mortgage payment is just a regular budget expense — enter it as a transaction categorized to a "Mortgage" expense category.
        </div>

        <p style={{ ...S.body, fontWeight: 600, marginBottom: 6 }}>Starting balances for debt accounts:</p>
        <p style={S.body}>
          Enter the amount you owe as a positive number. The app stores it as negative automatically — for Liability accounts and for Tracking accounts with the Mortgage or Loan subtype.
        </p>
      </section>

      {/* ── 05 Income vs. Expenses (IN / OUT) ─────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>05</div>
        <h2 style={S.sectionTitle}>Income vs. Expenses (IN / OUT)</h2>

        <p style={S.body}>
          The IN and OUT cards on the Dashboard summarize money movement for the selected month.
        </p>

        <div style={S.termGrid}>
          <div style={S.term}>IN</div>
          <div style={S.termDef}>
            Total positive transactions in on-budget asset accounts. Transfers between your own asset accounts (e.g., moving money from savings to checking) are excluded so they don't inflate income.
          </div>

          <div style={S.term}>OUT</div>
          <div style={S.termDef}>
            Total of all categorized spending across every account — credit card purchases, bills, debt payments. For split transactions, only the categorized portion of each split counts. Pure transfers with no budget category (e.g., paying off a credit card in full from checking) are excluded.
          </div>
        </div>

        <div style={S.callout}>
          The <strong>Money Flow</strong> chart below IN / OUT visualizes the same income flowing into each category group as a Sankey diagram.
        </div>
      </section>

      {/* ── 06 Net Worth ──────────────────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>06</div>
        <h2 style={S.sectionTitle}>Net Worth</h2>

        <p style={S.body}>
          Net worth is the sum of every account balance — assets, liabilities, and tracking accounts combined. Hover the Net Worth card on the Dashboard to see it broken down by account type.
        </p>

        <div style={S.formulaCard}>
          <div style={S.formulaRow}><span style={S.formulaOperator}> </span><span>Asset balances</span></div>
          <div style={S.formulaRow}><span style={S.formulaOperator}>+</span><span>Tracking balances (home, car, mortgage…)</span></div>
          <div style={S.formulaRow}><span style={S.formulaOperator}>+</span><span>Liability balances (negative — money owed)</span></div>
          <hr style={S.formulaDivider} />
          <div style={S.formulaResult}><span style={{ minWidth: 12 }}> </span><span>Net Worth</span></div>
        </div>

        <p style={S.body}>
          Tracking accounts with the Mortgage or Loan subtype store a negative balance, so they correctly reduce net worth just like a liability. The difference is they're off-budget — they don't create debt categories or affect your spendable cash calculation.
        </p>
      </section>

      {/* ── 07 Scheduled – Unbudgeted ─────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>07</div>
        <h2 style={S.sectionTitle}>Scheduled – Unbudgeted</h2>

        <p style={S.body}>
          Schedules represent recurring bills, subscriptions, or income — anything that happens on a predictable pattern. They appear as ghost rows at the top of the Ledger before they post, and they factor into the Unassigned Cash calculation on the Dashboard.
        </p>

        <div style={S.termGrid}>
          <div style={S.term}>Post</div>
          <div style={S.termDef}>Creates the actual transaction in your ledger and advances the schedule to its next occurrence. Use this when the bill has cleared or the paycheck has arrived.</div>

          <div style={S.term}>Skip</div>
          <div style={S.termDef}>Advances the schedule to the next occurrence without creating a transaction. Use this for a one-time skip (e.g., a bill that was waived).</div>

          <div style={S.term}>Auto-post</div>
          <div style={S.termDef}>When enabled on a schedule, the transaction posts automatically on its due date without any action needed.</div>
        </div>

        <div style={S.callout}>
          Schedules only affect the Dashboard's <strong>Scheduled – Unbudgeted</strong> deduction if they fall within the selected window (next 30 days or month-end) <em>and</em> the category doesn't already have enough reserved to cover them.
        </div>
      </section>

      {/* ── 08 Reconciliation ─────────────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>08</div>
        <h2 style={S.sectionTitle}>Reconciliation</h2>

        <p style={S.body}>
          Reconciliation is how you confirm that your records match your bank statement. Do this whenever you receive a statement or want to lock in a confirmed balance.
        </p>

        <p style={{ ...S.body, fontWeight: 600, marginBottom: 6 }}>How to reconcile:</p>
        <ol style={S.stepList}>
          <li style={S.stepItem}>As transactions appear on your bank's website or statement, check the <strong>✓ Cleared</strong> checkbox on each one in the Ledger.</li>
          <li style={S.stepItem}>When you're ready to reconcile, select the account in the Ledger dropdown and click <strong>Reconcile</strong>.</li>
          <li style={S.stepItem}>Enter the ending balance shown on your statement.</li>
          <li style={S.stepItem}>If the cleared balance matches, all cleared transactions are locked. If there's a difference, an adjustment transaction is created to close the gap, then everything is locked.</li>
        </ol>

        <div style={S.termGrid}>
          <div style={S.term}>Cleared</div>
          <div style={S.termDef}>You've seen this transaction on your bank's side and confirmed it's correct. It's been checked but not yet locked.</div>

          <div style={S.term}>Reconciled</div>
          <div style={S.termDef}>The transaction was part of a completed reconciliation and is now locked. Reconciled transactions shouldn't be edited.</div>

          <div style={S.term}>Adjustment</div>
          <div style={S.termDef}>A transaction created automatically during reconciliation to make the cleared balance match your statement exactly. Usually indicates a missing or duplicate transaction — worth investigating afterward.</div>
        </div>
      </section>

      {/* ── 09 Tags ───────────────────────────────────────────────── */}
      <section style={S.section}>
        <div style={S.sectionNumber}>09</div>
        <h2 style={S.sectionTitle}>Tags</h2>

        <p style={S.body}>
          Tags are free-form labels you can attach to transactions (or to individual splits in a split transaction) to track spending across categories. They're optional and additive — a transaction can have any number of tags.
        </p>

        <p style={S.body}>
          A common use case: tag every transaction related to a vacation, home project, or event with a shared label. You can then look up all transactions with that tag regardless of which category they're in.
        </p>

        <p style={{ ...S.body, fontWeight: 600, marginBottom: 6 }}>How to add tags:</p>
        <ol style={S.stepList}>
          <li style={S.stepItem}>When adding a transaction, type a tag name in the <strong>Tags</strong> field and press Enter or comma to add it.</li>
          <li style={S.stepItem}>Existing tags will appear as autocomplete suggestions.</li>
          <li style={S.stepItem}>Remove a tag by clicking the × next to it, or press Backspace to remove the last one.</li>
          <li style={S.stepItem}>In a split transaction, each split line has its own tags field.</li>
        </ol>
      </section>
    </div>
  );
}
