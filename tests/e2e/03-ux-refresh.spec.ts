import { expect, test } from '@playwright/test';
import { login, quickAdd } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('new Home dashboard reuses existing tasks, projects and calendar navigation', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: /Hello,|Welcome home/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Today's focus" })).toBeVisible();
  await expect(page.getByRole('link', { name: /Calendar/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Plan something' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('All tasks searches and filters real task data', async ({ page }, info) => {
  const title = `UX refresh ${info.project.name}`;
  await quickAdd(page, `${title} tomorrow`);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await page.getByLabel('Filter tasks by name').fill(title);
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  await page.getByRole('button', { name: 'Anytime', exact: true }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeHidden();
});

test('mobile navigation sheet retains access to Inbox, settings and existing pages', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile-only navigation');
  await page.goto('/home');
  await expect(page.getByRole('navigation', { name: 'Primary pages' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const menu = page.getByRole('navigation', { name: 'All pages' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL(/\/inbox/);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
