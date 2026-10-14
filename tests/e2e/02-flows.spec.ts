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

test('quick add pickers: date, repeat, labels, reminder and project all open and apply', async ({ page }, info) => {
  const proj = `Pick ${info.project.name}`;
  const title = `Pickers ${info.project.name}`;
  const label = `errand-${info.project.name}`;
  await page.goto('/browse');
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByLabel('Project name').fill(proj);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: proj })).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Add task/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Task name').fill(title);

  await dlg.getByRole('button', { name: /Change project/ }).click();
  await page.getByRole('button', { name: proj, exact: true }).click();
  await expect(dlg.getByRole('button', { name: new RegExp(`Project: ${proj}`) })).toBeVisible();

  await dlg.getByRole('button', { name: 'Date' }).click();
  await page.getByRole('button', { name: /^Tomorrow/ }).click();
  await page.keyboard.press('Escape');

  await dlg.getByRole('button', { name: 'Labels' }).click();
  await page.getByLabel('Search or create label').fill(label);
  await page.getByRole('button', { name: new RegExp(`Create "${label}"`) }).click();
  await page.keyboard.press('Escape');
  await expect(dlg.getByRole('button', { name: new RegExp(label) })).toBeVisible();

  await dlg.getByRole('button', { name: 'Repeat' }).click();
  await page.getByRole('button', { name: 'Every week', exact: true }).click();
  await expect(dlg.getByRole('button', { name: /Every week/ })).toBeVisible();

  await dlg.getByRole('button', { name: 'Reminders' }).click();
  await page.getByLabel('Add a reminder').selectOption({ label: '10 minutes before' });
  await page.keyboard.press('Escape');
  await expect(dlg.getByRole('button', { name: /1 reminder/ })).toBeVisible();

  await dlg.getByRole('button', { name: /Add task/ }).click();
  await expect(dlg).toBeHidden();

  await page.goto('/upcoming');
  await page.getByRole('button', { name: `Open ${title}` }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(/Every week/).first()).toBeVisible();
  await expect(sheet.getByText(label).first()).toBeVisible();
  await expect(sheet.getByText(/10 minutes before/).first()).toBeVisible();
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
