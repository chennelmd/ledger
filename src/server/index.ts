import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { basicAuth } from 'hono/basic-auth';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { accountsRouter } from './routes/accounts.js';
import { categoriesRouter } from './routes/categories.js';
import { payeesRouter } from './routes/payees.js';
import { transactionsRouter } from './routes/transactions.js';
import { budgetRouter } from './routes/budget.js';
import { dashboardRouter } from './routes/dashboard.js';
import { schedulesRouter } from './routes/schedules.js';
import { tagsRouter } from './routes/tags.js';

const isProd = process.env.NODE_ENV === 'production';

const app = new Hono();

app.use('*', logger());

// Basic Auth — required in production. Set AUTH_USERNAME and AUTH_PASSWORD
// as environment variables. The app refuses to start in production without them.
if (isProd) {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) {
    console.error('ERROR: AUTH_USERNAME and AUTH_PASSWORD must be set in production.');
    process.exit(1);
  }
  app.use('/*', basicAuth({ username, password }));
}

// CORS is only needed in dev — in production the server hosts both the client
// and API from the same origin, so there are no cross-origin requests.
if (!isProd) {
  app.use('/api/*', cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
}

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.route('/api/accounts', accountsRouter);
app.route('/api/categories', categoriesRouter);
app.route('/api/payees', payeesRouter);
app.route('/api/transactions', transactionsRouter);
app.route('/api/budget', budgetRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/schedules', schedulesRouter);
app.route('/api/tags', tagsRouter);

// In production, serve the Vite-built client after API routes so /api/* is never intercepted.
if (isProd) {
  app.use('/*', serveStatic({ root: './dist/client' }));
}

// SPA fallback in production: any request that didn't match a static file or
// API route gets the React shell so the client-side router can take over.
if (isProd) {
  app.notFound((c) => {
    const html = readFileSync('./dist/client/index.html', 'utf-8');
    return c.html(html);
  });
}

const port = Number(process.env.PORT ?? 3000);
console.log(`→ Server listening on http://localhost:${port} [${isProd ? 'production' : 'development'}]`);

serve({ fetch: app.fetch, port });
