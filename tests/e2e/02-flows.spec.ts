import { expect, test } from '@playwright/test';
import { axeViolations, login, quickAdd } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('quick add parses natural language and the task shows on Today; completing it has an undo', async ({ page }, info) => {
  const title = `Pay rent ${info.project.name}`;
  await quickAdd(page, `${title} today p1`);
  const open = page.getByRole('button', { name: `Open ${title}` });
  await expect(open).toBeVisible();
  await page.getByRole('checkbox', { name: `Complete ${title}` }).click();
  await expect(page.getByText(/completed/i).first()).toBeVisible();
  await expect(open).toBeHidden();
  await page.getByRole('button', { name: /undo/i }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible();
});

test('projects: create, add a task, find it by search', async ({ page }, info) => {
  const name = `Project ${info.project.name}`;
  await page.goto('/browse');
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await quickAdd(page, `Plan kickoff ${info.project.name}`);
  await page.goto('/search');
  await page.getByLabel('Search tasks, projects and labels').fill(`kickoff ${info.project.name}`);
  await expect(page.getByRole('button', { name: `Open Plan kickoff ${info.project.name}` })).toBeVisible();
});

test('main pages render without accessibility violations', async ({ page }) => {
  const found: string[] = [];
  page.on('pageerror', (e) => found.push('pageerror: ' + e.message));
  for (const path of ['/today', '/inbox', '/upcoming', '/calendar', '/browse', '/labels', '/templates', '/activity', '/settings', '/settings/appearance', '/settings/accounts', '/settings/security']) {
    await page.goto(path);
    if (!(await page.locator('main').isVisible({ timeout: 5000 }).catch(() => false))) { found.push(path + ': main not rendered'); continue; }
    await page.waitForLoadState('networkidle');
    found.push(...(await axeViolations(page, path)));
  }
  expect(found).toEqual([]);
});

test('offline: changes queue locally and sync when the connection returns', async ({ page, context }, info) => {
  const title = `Offline task ${info.project.name}`;
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await quickAdd(page, `${title} today`);
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  await expect(page.getByText(/offline/i).first()).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/waiting/i)).toBeHidden({ timeout: 30_000 });
  const found = await page.evaluate(async (q) => (await (await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`)).text()), title);
  expect(found).toContain(title);
});

test('settings: calendar accounts explain missing provider credentials instead of failing', async ({ page }) => {
  await page.goto('/settings/accounts');
  await page.getByRole('button', { name: /Connect Google Calendar/ }).click();
  await expect(page.getByText(/GOOGLE_CLIENT_ID/)).toBeVisible();
});

test('the app shell has a web manifest and registers a service worker', async ({ page }) => {
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const json = await manifest.json();
  expect(json.display).toBe('standalone');
  await page.goto('/today');
  const hasSw = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
  expect(hasSw).toBe(true);
});
