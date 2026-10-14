import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const USER = 'e2eowner';
export const PASS = 'E2e-Correct-Horse-42';
const codeFile = resolve(process.cwd(), '.test-data/e2e/setup-code.txt');

export function setupCode(): string {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      return readFileSync(codeFile, 'utf8').trim();
    } catch {
      if (Date.now() > deadline) throw new Error('setup code file not found');
    }
  }
}

export async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('main, input[autocomplete="username"], #username').or(page.getByLabel('Username')).first().waitFor();
  if (await page.getByLabel('Username').count()) {
    await page.getByLabel('Username').fill(USER);
    await page.getByLabel('Password').fill(PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page).toHaveURL(/\/today/);
}

export async function axeViolations(page: Page, name: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 200)}`);
}

export async function a11y(page: Page, name: string): Promise<void> {
  expect(await axeViolations(page, name), `axe violations on ${name}`).toEqual([]);
}

export async function quickAdd(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Add task/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Task name').fill(text);
  await dlg.getByRole('button', { name: /Add task/ }).click();
  await expect(dlg).toBeHidden();
}
