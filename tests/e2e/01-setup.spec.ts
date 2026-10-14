import { expect, test } from '@playwright/test';
import { PASS, USER, a11y, setupCode } from './helpers';

test('first run: setup screen creates the owner and opens Today', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);
  await a11y(page, 'setup');
  await page.getByLabel('Setup code').fill('WRONG-CODE-0000');
  await page.getByLabel('Your name').fill('E2E Owner');
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm password').fill(PASS);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible(); // wrong code is rejected with a message
  await page.getByLabel('Setup code').fill(setupCode());
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

test('login page: bad password shows an error, good password signs in', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/login');
  await a11y(page, 'login');
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill('Not-The-Password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today/);
});
