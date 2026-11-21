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

test('dashboard widgets can be hidden, restored and reordered', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible();
  await page.getByRole('button', { name: 'Customize' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Hide Your week' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Your week' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Customize' }).click();
  await dialog.getByRole('button', { name: 'Show Your week' }).click();
  await dialog.getByRole('button', { name: 'Restore default sections' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible();
  await page.getByRole('link', { name: /open tasks/ }).first().click();
  await expect(page).toHaveURL(/\/calendar\?date=/);
});

test('all tasks can be grouped, sorted and collapsed without losing actions', async ({ page }, info) => {
  const title = `Grouped task ${info.project.name}`;
  await quickAdd(page, `${title} today`);
  await page.goto('/tasks');
  await page.getByLabel('Filter tasks by name').fill(title);
  const group = page.getByRole('region', { name: 'Today' });
  await expect(group.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  await group.getByRole('button', { name: /Today/ }).click();
  await expect(group.getByRole('button', { name: `Open ${title}` })).toBeHidden();
  await group.getByRole('button', { name: /Today/ }).click();
  await page.getByLabel('Sort all tasks by').selectOption('priority');
  await expect(group.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  await page.getByLabel('Group tasks by').selectOption('project');
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  await page.getByLabel('Group tasks by').selectOption('schedule');
  await page.getByLabel('Sort all tasks by').selectOption('due');
});

test('mobile capture bar stays docked beneath the scroll area and not over task cards', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile-only layout assertion');
  await page.goto('/home');
  const dock = page.locator('.wos-capture-dock');
  const footer = page.locator('.wos-capture-footer');
  await expect(dock).toBeVisible();
  const main = await page.locator('#main').boundingBox();
  const footerBox = await footer.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(main).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  if (!main || !footerBox || !dockBox) return;
  // The full-height app reserves space for the dock: the scrollable tasks end above it.
  expect(main.y + main.height).toBeLessThanOrEqual(footerBox.y + 2);
  expect(dockBox.y).toBeGreaterThanOrEqual(footerBox.y);
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(footerBox.y + footerBox.height + 1);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(footerBox.y + footerBox.height).toBeGreaterThanOrEqual(viewportHeight - 4);
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(viewportHeight + 4);
  await dock.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('mobile task details show the full title and keep metadata below the editor', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile-only title layout regression');
  const title = 'Fix mobile UI and verify reminders show correctly in the task detail view after editing a long multi-line title on an iPhone';
  await quickAdd(page, title);
  await page.goto('/tasks');
  await page.getByLabel('Filter tasks by name').fill('Fix mobile UI and verify reminders');
  await page.getByRole('button', { name: `Open ${title}` }).click();

  const editor = page.getByRole('textbox', { name: 'Task title' });
  await expect(editor).toHaveValue(title);
  const measurements = await editor.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const chips = element.closest('.wos-task-title-row')?.nextElementSibling?.getBoundingClientRect();
    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      bottom: box.bottom,
      chipsTop: chips?.top ?? 0,
    };
  });
  expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.clientHeight + 3);
  expect(measurements.chipsTop).toBeGreaterThanOrEqual(measurements.bottom - 2);

  // Editing should keep growing the title and must not hide the other sections.
  await editor.fill(`${title} and make sure all text remains accessible`);
  const resized = await editor.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(resized.scrollHeight).toBeLessThanOrEqual(resized.clientHeight + 3);
  await editor.blur();
  const subtasks = page.getByRole('region', { name: 'Subtasks' });
  await subtasks.scrollIntoViewIfNeeded();
  await expect(subtasks).toBeInViewport();
});
