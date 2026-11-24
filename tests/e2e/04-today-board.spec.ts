import { expect, test } from '@playwright/test';
import { login, quickAdd } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('Today can switch List / Columns and persist layout after reload', async ({ page }, info) => {
  await page.goto('/today');
  await expect(page.getByRole('radiogroup', { name: 'Today layout' })).toBeVisible();
  await page.getByRole('radio', { name: 'Columns' }).click();
  await expect(page.getByRole('region', { name: 'To Do column' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Done column' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Columns' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
});

test('Today columns move tasks To Do -> Done -> To Do and save card status update', async ({ page }, info) => {
  const title = `Board workflow ${info.project.name}`;
  await quickAdd(page, `${title} today`);
  await page.goto('/today');
  await page.getByRole('radio', { name: 'Columns' }).click();

  const todo = page.getByRole('region', { name: 'To Do column' });
  const done = page.getByRole('region', { name: 'Done column' });
  const note = todo.getByRole('textbox', { name: `Status update for ${title}` });
  await expect(note).toBeVisible();
  await note.fill('Blocked until design approval');
  await note.blur();
  await expect(note).toHaveValue('Blocked until design approval');

  const card = todo.getByRole('article').filter({ hasText: title });
  await card.getByRole('button', { name: 'Move to Done' }).click();
  await expect(done.getByRole('article').filter({ hasText: title })).toBeVisible();
  await expect(done.getByRole('textbox', { name: `Status update for ${title}` })).toHaveValue('Blocked until design approval');

  await done.getByRole('article').filter({ hasText: title }).getByRole('button', { name: 'Move to To Do' }).click();
  await expect(todo.getByRole('article').filter({ hasText: title })).toBeVisible();
  await page.reload();
  await expect(todo.getByRole('textbox', { name: `Status update for ${title}` })).toHaveValue('Blocked until design approval');
  await page.getByRole('radio', { name: 'List' }).click();
});

test('desktop drag handle can complete a Today card by dropping into Done', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Pointer drop regression on desktop');
  const title = 'Drag board card today';
  await quickAdd(page, title);
  await page.goto('/today');
  await page.getByRole('radio', { name: 'Columns' }).click();
  const from = page.getByRole('button', { name: `Drag ${title.replace(' today','')}` });
  const target = page.getByRole('region', { name: 'Done column' });
  await from.dragTo(target, { targetPosition: { x: 75, y: 120 } });
  await expect(target.getByRole('article').filter({ hasText: 'Drag board card' })).toBeVisible();
  await page.getByRole('radio', { name: 'List' }).click();
});
