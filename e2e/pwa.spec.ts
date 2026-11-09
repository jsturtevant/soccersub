import { expect, test, type Page } from '@playwright/test';
import { emptyState, generateBlocks, type Player } from '../src/domain';
import { createRun } from '../src/engine';

async function offerInstall(page: Page, fails = false) {
  return page.evaluate((fails) => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperty(event, 'prompt', {
      value: async () => {
        if (fails) throw new Error('Installation is unavailable.');
        localStorage.setItem(
          'test.install-prompts',
          String(Number(localStorage.getItem('test.install-prompts') ?? 0) + 1),
        );
      },
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, fails);
}

test('PWA offers installation only for an available browser prompt', async ({
  page,
}) => {
  await page.goto('./');
  expect(await offerInstall(page)).toBe(true);
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('test.install-prompts')),
  ).toBe('1');
  await expect(
    page.getByRole('button', { name: 'Install app', exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  expect(await offerInstall(page)).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Install app', exact: true }),
  ).toHaveCount(0);
});

test('PWA reports install prompt failures', async ({ page }) => {
  await page.goto('./');
  await offerInstall(page, true);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'App availability' }),
  ).toContainText('Installation is unavailable.');
});

test('PWA does not offer installation when opened as an installed app', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = matchMedia(query);
      if (query === '(display-mode: standalone)')
        Object.defineProperty(media, 'matches', { value: true });
      return media;
    };
  });
  await page.goto('./');
  expect(await offerInstall(page)).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Install app', exact: true }),
  ).toHaveCount(0);
});

test('PWA blocks manual updates during a game and preserves it when the browser activates an update', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright worker inspection requires Chromium.',
  );
  let revision = 0;
  await context.route('**/sw.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body: `${source}\n// Test revision ${revision}`,
    });
  });
  const players: Player[] = Array.from({ length: 7 }, (_, index) => ({
    id: `player-${index}`,
    name: `Player ${index}`,
    number: '',
    roles: [],
  }));
  const template = {
    id: 'plan',
    name: 'Update-safe plan',
    formationId: '7:2-3-1',
    duration: 3600,
    interval: 300,
    blocks: generateBlocks(players, '7:2-3-1', 3600, 300),
  };
  const team = {
    id: 'team',
    name: 'Update United',
    archived: false,
    players,
    templates: [template],
  };
  const state = {
    ...emptyState(),
    teams: [team],
    active: createRun(team, template, players, '2026-11-08', ''),
  };
  await page.addInitScript((state) => {
    if (!localStorage.getItem('soccersub.v1'))
      localStorage.setItem('soccersub.v1', JSON.stringify(state));
  }, state);
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  revision = 1;
  const workerStarted = context.waitForEvent('serviceworker');
  await page.evaluate(async () =>
    (await navigator.serviceWorker.ready).update(),
  );
  const updatedWorker = await workerStarted;
  await expect(
    page.getByRole('button', { name: 'Update app', exact: true }),
  ).toBeVisible();
  const banner = page.getByRole('status', { name: 'App availability' });
  expect(
    await banner.evaluate((node) => {
      const header = document.querySelector('.app-header');
      return (
        header !== null &&
        node.getBoundingClientRect().bottom <=
          header.getBoundingClientRect().top
      );
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(banner).toBeInViewport();
  await page.getByRole('button', { name: 'Update app', exact: true }).click();
  await expect(
    page.getByText('End or discard the active game before updating.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
    ),
  ).toEqual(state.active);
  await page.close();
  await expect
    .poll(() =>
      updatedWorker.evaluate(
        "self.registration.waiting === null && self.registration.active?.state === 'activated'",
      ),
    )
    .toBe(true);
  const reopened = await context.newPage();
  await reopened.goto('./');
  await expect(
    reopened.getByRole('heading', { name: 'Unfinished game found' }),
  ).toBeVisible();
  expect(
    await reopened.evaluate(
      () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
    ),
  ).toEqual(state.active);
});

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
