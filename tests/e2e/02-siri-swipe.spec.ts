import { expect, test, type Page } from '@playwright/test';
import { login, quickAdd } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

/** Drags one finger horizontally across the row whose text matches. Real touch events, with a frame between each. */
async function swipe(page: Page, title: string, dx: number) {
  const surface = page.locator('[data-swipe-surface]', { hasText: title }).first();
  await expect(surface).toBeVisible();
  const box = (await surface.boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const steps = [0, dx * 0.2, dx * 0.6, dx];
  for (let i = 0; i < steps.length + 1; i++) {
    const type = i === 0 ? 'touchstart' : i === steps.length ? 'touchend' : 'touchmove';
    const x = x0 + (steps[Math.min(i, steps.length - 1)] as number);
    await surface.evaluate((el, a) => {
      const t = new Touch({ identifier: 7, target: el, clientX: a.x, clientY: a.y });
      el.dispatchEvent(new TouchEvent(a.type, { bubbles: true, cancelable: true, touches: a.type === 'touchend' ? [] : [t], targetTouches: a.type === 'touchend' ? [] : [t], changedTouches: [t] }));
    }, { type, x: i === 0 ? x0 : x, y: y0 });
    await page.waitForTimeout(40);
  }
}

test('swipe left archives (with undo and an Archived list), swipe right deletes (with undo)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch gesture');
  const a = `Archive swipe ${info.project.name}`;
  const d = `Delete swipe ${info.project.name}`;
  await quickAdd(page, `${a} today`);
  await quickAdd(page, `${d} today`);
  await page.goto('/today');

  await swipe(page, a, -140);
  await expect(page.getByRole('button', { name: `Open ${a}` })).toBeHidden();
  await expect(page.getByText(/Archived "/)).toBeVisible();

  await page.goto('/archived');
  await expect(page.getByText(a)).toBeVisible();
  await page.getByRole('button', { name: `Restore ${a}` }).click();
  await page.goto('/today');
  await expect(page.getByRole('button', { name: `Open ${a}` })).toBeVisible();

  await swipe(page, d, 140);
  await expect(page.getByRole('button', { name: `Open ${d}` })).toBeHidden();
  await expect(page.getByText(/Deleted "/)).toBeVisible();
  await page.getByRole('button', { name: /undo/i }).click();
  await expect(page.getByRole('button', { name: `Open ${d}` })).toBeVisible();

  // a short drag does nothing
  await swipe(page, d, 30);
  await expect(page.getByRole('button', { name: `Open ${d}` })).toBeVisible();
});

test('swipe actions are configurable in Settings, General', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'settings are easiest to drive on desktop');
  await page.goto('/settings/general');
  await page.getByLabel('Swipe right action').selectOption('complete');
  await page.getByLabel('Swipe left action').selectOption('tomorrow');
  await page.reload();
  await expect(page.getByLabel('Swipe right action')).toHaveValue('complete');
  await expect(page.getByLabel('Swipe left action')).toHaveValue('tomorrow');
  await page.getByLabel('Swipe right action').selectOption('delete');
  await page.getByLabel('Swipe left action').selectOption('archive');
  await expect(page.getByLabel('Swipe left action')).toHaveValue('archive');
});

test('Siri & Apple Watch: create a token (shown once), capture a task with it, revoke it', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: /Step 1/ })).toBeVisible();
  await page.getByLabel('Token name').fill(`e2e ${info.project.name}`);
  await page.getByRole('button', { name: 'Create token' }).click();
  const shown = page.getByTestId('new-token');
  await expect(shown).toHaveText(/^wos_/);
  const token = (await shown.textContent())!;

  // the secret is part of the shortcut instructions while it is on screen, and gone after "Done"
  await expect(page.getByText(`Bearer ${token}`)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('new-token')).toBeHidden();
  await expect(page.getByText(token)).toHaveCount(0);

  // what a shortcut would send: bearer token only (the `request` fixture has no browser cookies)
  const res = await request.post('/api/v1/capture', { headers: { authorization: `Bearer ${token}` }, data: { text: `Siri e2e ${info.project.name} tomorrow 9am p2` } });
  expect(res.status()).toBe(201);
  expect((await res.json()).message).toContain('Siri e2e');
  expect((await request.get('/api/v1/tasks', { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401); // scoped to capture only

  await page.getByRole('button', { name: /^Revoke e2e/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect.poll(async () => (await request.post('/api/v1/capture', { headers: { authorization: `Bearer ${token}` }, data: { text: 'after revoke' } })).status()).toBe(401);
});

test('"Try it" sends a capture through the session and the Productivity page shows goals', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  await page.goto('/settings/integrations');
  await page.getByLabel('Test capture text').fill(`Try it ${info.project.name} today`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toBeVisible();
  await page.goto('/settings/productivity');
  await page.getByLabel('Daily goal', { exact: true }).fill('3');
  await page.getByLabel('Daily goal', { exact: true }).blur();
  await page.goto('/activity');
  await page.getByRole('radio', { name: 'Goals & karma' }).click();
  await expect(page.getByRole('progressbar', { name: 'Daily goal progress' })).toBeVisible();
  await page.goto('/settings/productivity');
  await page.getByLabel('Daily goal', { exact: true }).fill('5');
  await page.getByLabel('Daily goal', { exact: true }).blur();
});
