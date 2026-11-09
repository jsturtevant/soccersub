import { expect, test } from '@playwright/test';

test('PWA manifest uses the hosting scope and serves installation icons', async ({
  page,
  request,
}) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const url = new URL(href!, page.url());
  const response = await request.get(url.href);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.start_url).toBe(process.env.E2E_BASE_PATH || '/');
  expect(manifest.scope).toBe(process.env.E2E_BASE_PATH || '/');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, url).href)).ok()).toBe(true);
  }
});

test('PWA reloads offline with the saved roster', async ({ page, context }) => {
  await page.goto('./');
  await page.getByLabel('Create a team').fill('Offline United');
  await page.getByRole('button', { name: 'Add team', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /Offline United/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Offline United', exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
});
