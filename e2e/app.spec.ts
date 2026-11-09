import { expect, test, type Page } from '@playwright/test';
import {
  emptyState,
  generateBlocks,
  type Player,
  type Template,
} from '../src/domain';
import { createRun } from '../src/engine';

const players: Player[] = Array.from({ length: 12 }, (_, index) => ({
  id: `p${index}`,
  name: [
    'Alex',
    'Blair',
    'Casey',
    'Drew',
    'Eden',
    'Frankie',
    'Gray',
    'Harper',
    'Indigo',
    'Jules',
    'Kai',
    'Lee',
  ][index],
  number: String(index + 1),
  roles: index < 2 ? ['goalkeeper'] : ['midfielder'],
}));
const template: Template = {
  id: 'template',
  name: 'Saturday 9v9',
  formationId: '9:3-2-3',
  duration: 120,
  interval: 30,
  blocks: generateBlocks(players, '9:3-2-3', 120, 30),
};
const team = {
  id: 'team',
  name: 'Riverside U12',
  archived: false,
  players,
  templates: [template],
};

async function seed(page: Page, active = false) {
  const state = {
    ...emptyState(),
    teams: [team],
    active: active
      ? createRun(team, template, players, '2026-11-08', 'United')
      : null,
  };
  await page.addInitScript((state) => {
    if (!localStorage.getItem('soccersub.v1'))
      localStorage.setItem('soccersub.v1', JSON.stringify(state));
  }, state);
}

for (const name of ['', '   ']) {
  test(`saves a generated plan with a ${name ? 'whitespace' : 'blank'} name`, async ({
    page,
  }) => {
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: /Riverside U12/ }).click();
    await page.getByRole('button', { name: 'New plan', exact: true }).click();
    await page.getByLabel('Plan name').fill(name);
    await page.getByLabel('Total game minutes').fill('2');
    await page.getByLabel('Rotation every').fill('0.5');
    await page
      .getByRole('button', { name: 'Generate lineups', exact: true })
      .click();
    await page
      .getByLabel('Player in field slot 1 (goalkeeper)', { exact: true })
      .selectOption('p1');
    await expect(
      page.getByRole('button', { name: 'Save plan', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Game plan', exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /Riverside U12/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Game plan', exact: true }),
    ).toBeVisible();
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('soccersub.v1')!),
    );
    expect(state.teams[0].templates[1].blocks[0].lineup[0]).toBe('p1');
  });
}

test('keeps a failed player edit open and reports the storage error', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await page.getByRole('button', { name: 'Edit Alex', exact: true }).click();
  await page.getByLabel('Player name').fill('Avery');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is full.', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Save player', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full.');
  await expect(page.getByLabel('Player name')).toHaveValue('Avery');
});

test('keeps unresolved substitutions visible at halftime', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(65_000);
  await expect(
    page.getByRole('heading', { name: 'Halftime', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start second half', exact: true }),
  ).toBeDisabled();
});

test('sounds alerts while the coach is viewing history', async ({ page }) => {
  await page.addInitScript(() => {
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when?: number) {
      localStorage.setItem(
        'test.tones',
        String(Number(localStorage.getItem('test.tones') ?? 0) + 1),
      );
      original.call(this, when);
    };
  });
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.clock.runFor(35_000);
  await expect
    .poll(() =>
      page.evaluate(() => Number(localStorage.getItem('test.tones') ?? 0)),
    )
    .toBeGreaterThan(0);
});

test('creates a roster player and persists it across reloads', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Create a team').fill('Northside');
  await page.getByRole('button', { name: 'Add team', exact: true }).click();
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await page.getByLabel('Player name').fill('Morgan');
  await page.getByLabel('Shirt number').fill('8');
  await page.getByLabel('defender', { exact: true }).check();
  await page
    .getByRole('button', { name: 'Add player', exact: true })
    .last()
    .click();
  await expect(page.getByRole('button', { name: 'Edit Morgan' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Northside/ }).click();
  await expect(page.getByRole('button', { name: 'Edit Morgan' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('edits a preset lineup and starts an independent game run', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Fresh plan');
  await page.getByLabel('Total game minutes').fill('2');
  await page.getByLabel('Rotation every').fill('0.5');
  await page
    .getByRole('button', { name: 'Generate lineups', exact: true })
    .click();
  await expect(page.getByLabel('Soccer field')).toBeVisible();
  await page
    .getByLabel('Player in field slot 1 (goalkeeper)', { exact: true })
    .selectOption('p1');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const plan = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Fresh plan' }) });
  await plan.getByRole('button', { name: 'Use for game' }).click();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Game day' })).toBeVisible();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('soccersub.v1')!),
  );
  expect(state.active.templateId).toBe(state.teams[0].templates[1].id);
  expect(state.active.id).not.toBe(state.active.templateId);
});

test('stops at halftime after background time, resumes manually, and saves result', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(35_000);
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  await page.clock.runFor(90_000);
  await expect(
    page.getByRole('heading', { name: 'Halftime', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Total elapsed', { exact: true })).toHaveText(
    '1:00',
  );
  await page
    .getByRole('button', { name: 'Start second half', exact: true })
    .click();
  await page.clock.runFor(65_000);
  await expect(
    page.getByRole('heading', { name: 'Full time. Well played.' }),
  ).toBeVisible();
  await page.getByLabel('Our score').fill('3');
  await page.getByLabel('Their score').fill('1');
  await page.getByLabel('Match notes').fill('Good teamwork.');
  await page.getByRole('button', { name: 'Complete game' }).click();
  await expect(
    page.getByRole('heading', { name: 'Match history' }),
  ).toBeVisible();
  await expect(page.getByText('3 : 1', { exact: true })).toBeVisible();
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('soccersub.v1')!),
  );
  expect(data.active).toBeNull();
  expect(data.history[0].run.clock.elapsed).toBe(120);
});

test('rejects bad imports without replacing data and requires preview confirmation', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem('soccersub.v1'),
  );
  await page.getByLabel('Import backup').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":1,"teams":[]}'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('soccersub.v1'))).toBe(
    before,
  );
  await page.getByLabel('Import backup').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyState())),
  });
  await expect(
    page.getByRole('heading', { name: 'Replace all local data?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm replacement' }).click();
  await page.getByRole('button', { name: 'Teams & plans' }).click();
  await expect(page.getByRole('button', { name: /Riverside U12/ })).toHaveCount(
    0,
  );
});
