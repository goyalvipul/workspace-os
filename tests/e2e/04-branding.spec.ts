import { expect, test } from '@playwright/test';

test('new Workspace OS brand serves the expected favicon, touch icon and PWA assets', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/icons/workspace.svg');
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', '/icons/workspace-favicon-32.png');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/workspace-apple-touch.png');
  const svg = await page.request.get('/icons/workspace.svg');
  expect(svg.ok()).toBeTruthy();
  expect(await svg.text()).toContain('fill="url(#leaf)"');
  for (const name of ['workspace-favicon-16.png', 'workspace-favicon-32.png', 'workspace-apple-touch.png', 'workspace-192.png', 'workspace-512.png', 'workspace-maskable-512.png']) {
    const image = await page.request.get('/icons/' + name);
    expect(image.ok(), name).toBeTruthy();
    expect(image.headers()['content-type']).toContain('image/png');
    expect((await image.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
  // At the top-left of the illustrated tile, the new brand is ivory rather than
  // the old coral-filled box. Catch accidental regeneration with the old script.
  const rgba = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/icons/workspace-192.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(38, 38, 1, 1).data);
  });
  expect(rgba[0]).toBeGreaterThan(235);
  expect(rgba[1]).toBeGreaterThan(215);
  expect(rgba[2]).toBeGreaterThan(205);
});
