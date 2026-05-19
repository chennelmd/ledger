import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { accountsRouter } from './routes/accounts.js';
import { categoriesRouter } from './routes/categories.js';
import { payeesRouter } from './routes/payees.js';
import { transactionsRouter } from './routes/transactions.js';
import { budgetRouter } from './routes/budget.js';
import { dashboardRouter } from './routes/dashboard.js';
import { schedulesRouter } from './routes/schedules.js';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors({ origin: 'http://localhost:5173' }));

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.route('/api/accounts', accountsRouter);
app.route('/api/categories', categoriesRouter);
app.route('/api/payees', payeesRouter);
app.route('/api/transactions', transactionsRouter);
app.route('/api/budget', budgetRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/schedules', schedulesRouter);

const port = Number(process.env.PORT ?? 3000);
console.log(`→ Server listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
