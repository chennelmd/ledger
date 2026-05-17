import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:5173';
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = path.resolve('qa-artifacts');

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME_PATH,
  args: ['--no-sandbox'],
});

const failures = [];
const consoleErrors = [];
const failedRequests = [];
const badResponses = [];
const pageErrors = [];

function recordFailure(name, error) {
  failures.push({ name, message: error?.message ?? String(error) });
}

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    recordFailure(name, error);
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`);
});
page.on('pageerror', (error) => {
  pageErrors.push(error.message);
});
page.on('response', (response) => {
  const status = response.status();
  const url = response.url();
  if (status >= 400 && !url.includes('/@vite')) {
    badResponses.push(`${status} ${url}`);
  }
});

async function expectVisible(locator, name) {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await locator.isVisible(), true, `${name} should be visible`);
}

async function expectHidden(locator, name) {
  await locator.waitFor({ state: 'hidden', timeout: 10000 });
  assert.equal(await locator.isVisible(), false, `${name} should be hidden`);
}

await step('load app shell', async () => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  assert.equal(await page.title(), 'Budget');
  await expectVisible(page.getByRole('heading', { name: 'The Ledger' }), 'app heading');
  await expectVisible(page.getByRole('button', { name: 'Accounts' }), 'Accounts tab');
  await expectVisible(page.getByRole('button', { name: 'Budget' }), 'Budget tab');
  await expectVisible(page.getByRole('button', { name: 'Ledger' }), 'Ledger tab');
  await page.screenshot({ path: path.join(outDir, 'accounts.png'), fullPage: true });
});

await step('accounts list renders real data and modal opens', async () => {
  await expectVisible(page.getByRole('button', { name: 'AMHFCU Checking', exact: true }), 'checking account');
  await expectVisible(page.getByText('Chase'), 'Chase account');
  await page.getByRole('button', { name: '+ New Account' }).click();
  await expectVisible(page.getByRole('heading', { name: 'New Account' }), 'new account modal');
  await expectVisible(page.getByLabel('Name'), 'account name field');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expectHidden(page.getByRole('heading', { name: 'New Account' }), 'new account modal');
});

await step('budget page renders assignments and month controls', async () => {
  await page.getByRole('button', { name: 'Budget' }).click();
  await expectVisible(page.getByText('Ready to Assign'), 'ready to assign');
  await expectVisible(page.getByText('Fixed Expenses'), 'fixed expenses');
  await expectVisible(page.getByText('Mortgage'), 'mortgage category');
  await expectVisible(page.getByText('Discretionary Spending'), 'discretionary group');
  await page.getByRole('button', { name: '2', exact: true }).click();
  await expectVisible(page.getByText('May 26 – Jun 26'), 'two-month range label');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.screenshot({ path: path.join(outDir, 'budget.png'), fullPage: true });
});

await step('ledger page renders transactions and account filter', async () => {
  await page.getByRole('button', { name: 'Ledger' }).click();
  await expectVisible(page.getByRole('button', { name: '+ New Transaction' }), 'new transaction button');
  await expectVisible(page.getByText('Freedom Mortgage'), 'mortgage transaction');
  await expectVisible(page.getByText('Giant'), 'Giant transaction');
  await page.locator('select').selectOption({ label: 'AMHFCU Checking' });
  await expectVisible(page.getByText('Freedom Mortgage'), 'filtered mortgage transaction');
  await page.screenshot({ path: path.join(outDir, 'ledger.png'), fullPage: true });
});

await step('mobile viewport has usable primary navigation', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expectVisible(page.getByRole('heading', { name: 'The Ledger' }), 'mobile heading');
  await expectVisible(page.getByRole('button', { name: 'Accounts' }), 'mobile Accounts tab');
  await page.getByRole('button', { name: 'Budget' }).click();
  await expectVisible(page.getByText('Ready to Assign'), 'mobile ready to assign');
  await page.screenshot({ path: path.join(outDir, 'mobile-budget.png'), fullPage: true });
});

await browser.close();

const result = {
  failures,
  consoleErrors,
  pageErrors,
  failedRequests,
  badResponses,
  screenshots: [
    path.join(outDir, 'accounts.png'),
    path.join(outDir, 'budget.png'),
    path.join(outDir, 'ledger.png'),
    path.join(outDir, 'mobile-budget.png'),
  ],
};

console.log(JSON.stringify(result, null, 2));
const actionableConsoleErrors = consoleErrors.filter((message) => {
  return !message.startsWith('Failed to load resource:');
});
if (
  failures.length ||
  actionableConsoleErrors.length ||
  pageErrors.length ||
  failedRequests.length ||
  badResponses.length
) {
  process.exitCode = 1;
}
