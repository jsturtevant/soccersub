import { expect, test, type Page } from '@playwright/test';
import {
  emptyState,
  type Player,
  type Run,
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
  blocks: [
    { at: 0, lineup: players.slice(0, 9).map((player) => player.id) },
    {
      at: 30,
      lineup: ['p0', 'p9', ...players.slice(2, 9).map((player) => player.id)],
    },
    {
      at: 60,
      lineup: ['p1', 'p9', ...players.slice(2, 9).map((player) => player.id)],
    },
    {
      at: 90,
      lineup: [
        'p1',
        'p9',
        'p10',
        ...players.slice(3, 9).map((player) => player.id),
      ],
    },
  ],
};
const team = {
  id: 'team',
  name: 'Riverside U12',
  archived: false,
  players,
  templates: [template],
};

function previewRun() {
  const lineup = players.slice(0, 9).map((player) => player.id);
  const halfLineup = ['p11', ...lineup.slice(1)];
  return createRun(
    team,
    {
      ...template,
      blocks: [
        { at: 0, lineup },
        {
          at: 30,
          lineup: ['p0', 'p2', 'p9', 'p3', 'p4', 'p5', 'p10', 'p7', 'p8'],
        },
        { at: 60, lineup: halfLineup },
        { at: 90, lineup: halfLineup },
      ],
    },
    players,
    '2026-11-08',
    'United',
  );
}

function heldRun() {
  const lineup = players.slice(0, 9).map((player) => player.id);
  const firstChange = ['p0', 'p9', ...lineup.slice(2)];
  const secondHalf = ['p1', ...firstChange.slice(1)];
  return createRun(
    team,
    {
      ...template,
      duration: 240,
      blocks: [
        { at: 0, lineup },
        { at: 30, lineup },
        { at: 60, lineup: firstChange },
        { at: 90, lineup: firstChange },
        { at: 120, lineup: secondHalf },
        { at: 150, lineup: secondHalf },
        { at: 180, lineup: ['p1', 'p9', 'p10', ...lineup.slice(3)] },
        { at: 210, lineup: ['p1', 'p9', 'p10', ...lineup.slice(3)] },
      ],
    },
    players,
    '2026-11-09',
    'United',
  );
}

async function seed(page: Page, active: boolean | Run = false) {
  const state = {
    ...emptyState(),
    teams: [team],
    active:
      active === true
        ? createRun(team, template, players, '2026-11-08', 'United')
        : active || null,
  };
  await page.addInitScript((state) => {
    if (!localStorage.getItem('soccersub.v1'))
      localStorage.setItem('soccersub.v1', JSON.stringify(state));
  }, state);
}

async function selectBenchKeeper(page: Page) {
  const select = page.getByLabel('Player in field slot 1 (goalkeeper)', {
    exact: true,
  });
  const current = await select.inputValue();
  const replacement = await select
    .locator('option')
    .evaluateAll(
      (options, current) =>
        options.find((option) => option.value !== current)?.value,
      current,
    );
  if (!replacement) throw new Error('No benched goalkeeper is available.');
  await select.selectOption(replacement);
  return replacement;
}

test('previews only bench entrants and pairs due substitutions through halftime', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, previewRun());
  await page.goto('/');
  await expect(page.locator('.incoming-player')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const field = page.getByRole('group', { name: 'Live lineup', exact: true });
  const replacement = field.locator('.pitch-player').filter({
    has: page.getByText('Blair', { exact: true }),
  });
  await expect(replacement.locator('.incoming-player')).toHaveText(
    'Next Jules',
  );
  await expect(field.locator('.incoming-player')).toHaveCount(2);
  await expect(
    field.locator('.incoming-player').filter({ hasText: 'Casey' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(35_000);
  await expect(replacement.locator('.incoming-player')).toHaveText(
    'Next Jules',
  );
  await expect(
    page
      .getByRole('list', { name: 'Substitutions', exact: true })
      .locator('.sub-pair')
      .filter({ hasText: 'Blair' }),
  ).toHaveText(/OFF\s+Blair\s+→\s+ON\s+Jules/);
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  await expect(
    field
      .locator('.pitch-player')
      .filter({
        has: page.getByText('Alex', { exact: true }),
      })
      .locator('.incoming-player'),
  ).toHaveText('Next Lee');
  await page.clock.runFor(30_000);
  await expect(
    page.getByRole('heading', { name: 'Halftime', exact: true }),
  ).toBeVisible();
  await expect(
    field
      .locator('.pitch-player')
      .filter({
        has: page.getByText('Alex', { exact: true }),
      })
      .locator('.incoming-player'),
  ).toHaveText('Next Lee');
  await page
    .getByRole('button', { name: 'Start second half', exact: true })
    .click();
  await expect(field.locator('.incoming-player')).toHaveCount(0);
  await page.clock.runFor(65_000);
  await expect(field.locator('.incoming-player')).toHaveCount(0);
});

test('keeps actual-lineup correction closed until needed and saves edits', async ({
  page,
}) => {
  await seed(page, previewRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const correction = page.locator('details').filter({
    has: page.getByText('Adjust actual lineup', { exact: true }),
  });

  await expect(
    page.getByRole('button', { name: 'Apply actual lineup' }),
  ).not.toBeVisible();
  await correction.getByText('Adjust actual lineup', { exact: true }).click();
  await correction
    .getByLabel('Player in field slot 1 (goalkeeper)', { exact: true })
    .selectOption('p11');
  await correction.getByRole('button', { name: 'Apply actual lineup' }).click();
  await expect(
    page
      .getByLabel('Live lineup', { exact: true })
      .getByText('Lee', { exact: true }),
  ).toBeVisible();
  await correction.getByText('Adjust actual lineup', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Apply actual lineup' }),
  ).not.toBeVisible();
  await correction.getByText('Adjust actual lineup', { exact: true }).click();
  await expect(
    correction.getByLabel('Player in field slot 1 (goalkeeper)', {
      exact: true,
    }),
  ).toHaveValue('p11');
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('soccersub.v1')!),
  );
  expect(state.active.lineup[0]).toBe('p11');
});

test('edits upcoming substitutions without changing actual time and can keep an outgoing player', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
  );
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await page.getByLabel('On player 1', { exact: true }).selectOption('p1');
  await page
    .getByRole('button', { name: 'Add substitution', exact: true })
    .click();
  await page.getByLabel('On player 2', { exact: true }).selectOption('p11');
  await page.getByRole('button', { name: 'Save next substitutions' }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
  );
  expect(saved.lineup).toEqual(before.lineup);
  expect(saved.events).toEqual(before.events);
  expect(saved.blocks[1].lineup[1]).toBe('p1');
  expect(saved.blocks[1].lineup[2]).toBe('p11');
  await page.reload();
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(35_000);
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  const applied = await page.evaluate(
    () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
  );
  expect(applied.lineup).toEqual(saved.blocks[1].lineup);
});

test('retains the next-substitution draft when saving fails', async ({
  page,
}) => {
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await page.getByLabel('On player 1', { exact: true }).selectOption('p1');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage is full');
    };
  });
  await page.getByRole('button', { name: 'Save next substitutions' }).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByLabel('On player 1', { exact: true })).toHaveValue(
    'p1',
  );
  await expect(
    page.getByRole('button', { name: 'Save next substitutions' }),
  ).toBeVisible();
});

test('protects next-substitution edits when the next block advances', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await page.getByLabel('On player 1', { exact: true }).selectOption('p11');
  await page.clock.runFor(35_000);
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  await expect(
    page.getByRole('button', { name: 'Save next substitutions' }),
  ).toBeDisabled();
  await expect(
    page.getByText('The next block changed. Your edits are kept here.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use next planned block' }).click();
  await expect(
    page.getByRole('button', { name: 'Save next substitutions' }),
  ).toBeEnabled();
});
test('offers only the current player and bench players in every editable field slot', async ({
  page,
}) => {
  await seed(page, previewRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const correction = page.locator('details').filter({
    has: page.getByText('Adjust actual lineup', { exact: true }),
  });
  await correction.getByText('Adjust actual lineup', { exact: true }).click();
  const options = await correction.locator('select').evaluateAll((selects) =>
    selects.map((select) => ({
      current: select.value,
      options: [...select.options].map((option) => option.value),
    })),
  );
  for (const slot of options)
    expect(slot.options).toEqual([slot.current, 'p9', 'p10', 'p11']);
});

test('refreshes untouched correction and protects edits when the live lineup changes', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, previewRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const correction = page.locator('details').filter({
    has: page.getByText('Adjust actual lineup', { exact: true }),
  });
  await correction.getByText('Adjust actual lineup', { exact: true }).click();
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(35_000);
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  await expect(
    correction.getByLabel('Player in field slot 2', { exact: true }),
  ).toHaveValue('p2');
  await correction
    .getByLabel('Player in field slot 1 (goalkeeper)', { exact: true })
    .selectOption('p11');
  await page.clock.runFor(30_000);
  await page
    .getByRole('button', { name: 'Start second half', exact: true })
    .click();
  await expect(
    correction.getByRole('button', { name: 'Apply actual lineup' }),
  ).toBeDisabled();
  await expect(correction.getByRole('status')).toContainText(
    'The live lineup changed.',
  );
  await expect(correction.getByText('Lee', { exact: true })).toBeVisible();
  await correction.getByRole('button', { name: 'Use current lineup' }).click();
  await expect(
    correction.getByLabel('Player in field slot 2', { exact: true }),
  ).toHaveValue('p1');
  await expect(
    correction.getByRole('button', { name: 'Apply actual lineup' }),
  ).toBeEnabled();
});

test('saves generated lineups with the prefilled plan name', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await expect(page.getByLabel('Plan name')).toHaveValue('Saturday rotation');
  await page.getByLabel('Total game minutes').fill('2');
  await page.getByLabel('Rotation every').fill('0.5');
  await page
    .getByRole('button', { name: 'Generate lineups', exact: true })
    .click();
  const replacement = await selectBenchKeeper(page);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Saturday rotation', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Saturday rotation', exact: true }),
  ).toBeVisible();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('soccersub.v1')!),
  );
  expect(state.teams[0].templates[1].blocks[0].lineup[0]).toBe(replacement);
});

test('warns when short halves cannot give every player a turn', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await page.getByLabel('Total game minutes').fill('2');
  await page.getByLabel('Rotation every').fill('1');
  await page
    .getByRole('button', { name: 'Generate lineups', exact: true })
    .click();
  const warning = page.getByRole('status').filter({
    hasText: 'Rotation goals need attention',
  });
  await expect(warning).toContainText('No first-half playing time:');
  await expect(warning).toContainText('No second-half playing time:');
  await page.getByLabel('Rotation every').fill('0.5');
  await page.getByRole('button', { name: 'Regenerate lineups' }).click();
  await expect(warning).toHaveCount(0);
});

test('explains why a generated plan cannot be saved after clearing its name', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await page
    .getByRole('button', { name: 'Generate lineups', exact: true })
    .click();
  const nameWarning = page
    .getByRole('status')
    .filter({ hasText: 'Enter a plan name before saving.' });
  for (const name of ['', '   ']) {
    await page.getByLabel('Plan name').fill(name);
    await expect(
      page.getByRole('button', { name: 'Save plan', exact: true }),
    ).toBeDisabled();
    await expect(nameWarning).toHaveText('Enter a plan name before saving.');
  }
  await page.getByLabel('Plan name').fill('Sunday rotation');
  await expect(nameWarning).toHaveCount(0);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const plan = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Sunday rotation' }),
  });
  await plan.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Plan name')).toHaveValue('Sunday rotation');
});

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
  await selectBenchKeeper(page);
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

test('persists goalkeeper edits through the half in plans and game setup', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Riverside U12/ }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Keeper plan');
  await page.getByLabel('Total game minutes').fill('2');
  await page.getByLabel('Rotation every').fill('0.5');
  await page
    .getByRole('button', { name: 'Generate lineups', exact: true })
    .click();
  const keeper = await selectBenchKeeper(page);
  await page.getByRole('button', { name: '1st · 0:30', exact: true }).click();
  await expect(
    page.getByLabel('Player in field slot 1 (goalkeeper)', { exact: true }),
  ).toHaveValue(keeper);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  const plan = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Keeper plan' }) });
  await plan.getByRole('button', { name: 'Use for game' }).click();
  const gameKeeper = await selectBenchKeeper(page);
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await page.reload();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('soccersub.v1')!),
  );
  expect(
    state.active.blocks
      .filter((block: { at: number }) => block.at < 60)
      .map((block: { lineup: string[] }) => block.lineup[0]),
  ).toEqual([gameKeeper, gameKeeper]);
  expect(
    state.teams[0].templates[1].blocks
      .filter((block: { at: number }) => block.at < 60)
      .map((block: { lineup: string[] }) => block.lineup[0]),
  ).toEqual([keeper, keeper]);
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

test('requires confirmation to delete all app data including an unfinished game', async ({
  page,
}) => {
  await seed(page, previewRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem('soccersub.v1'),
  );
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('unfinished game');
    await dialog.dismiss();
  });
  await page
    .getByRole('button', { name: 'Delete all data', exact: true })
    .click();
  expect(await page.evaluate(() => localStorage.getItem('soccersub.v1'))).toBe(
    before,
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Delete all data', exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('soccersub.v1')!),
    ),
  ).toEqual(emptyState());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Live game' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Teams & plans' }).click();
  await expect(page.getByRole('button', { name: /Riverside U12/ })).toHaveCount(
    0,
  );
});

test('preserves data and reports a failed delete', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem('soccersub.v1'),
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is unavailable.', 'SecurityError');
    };
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Delete all data', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Storage is unavailable.',
  );
  expect(await page.evaluate(() => localStorage.getItem('soccersub.v1'))).toBe(
    before,
  );
});

test('shows the upcoming substitutions in the same paired rows as ready changes', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await seed(page, previewRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const upcoming = page.getByRole('list', {
    name: 'Upcoming substitutions',
    exact: true,
  });
  await expect(upcoming.getByRole('listitem')).toHaveCount(2);
  await expect(upcoming.getByRole('listitem').first()).toHaveText(
    /OFF\s+Blair\s+→\s+ON\s+Jules/,
  );
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(35_000);
  const ready = page.getByRole('list', { name: 'Substitutions', exact: true });
  expect(await upcoming.getByRole('listitem').allTextContents()).toEqual(
    await ready.getByRole('listitem').allTextContents(),
  );
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  await page.clock.runFor(30_000);
  await expect(
    upcoming.getByRole('listitem').filter({ hasText: 'Alex' }),
  ).toHaveText(/OFF\s+Alex\s+→\s+ON\s+Lee/);
  await page
    .getByRole('button', { name: 'Start second half', exact: true })
    .click();
  await expect(page.locator('.next-change')).toContainText('No bench changes');
});

test('updates estimated playing time from saved next substitutions while actual time stays unchanged', async ({
  page,
}) => {
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await expect(
    page.getByText('Estimated playing time', { exact: true }),
  ).toBeVisible();
  const estimate = page
    .locator('details')
    .filter({ has: page.getByText('Estimated playing time', { exact: true }) });
  await estimate.locator('summary').click();
  const lee = estimate
    .locator('.minutes > div')
    .filter({ has: page.getByText('Lee', { exact: true }) })
    .locator('strong');
  await expect(lee).toHaveText('0:00');
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await page.getByLabel('Off player 1', { exact: true }).selectOption('p2');
  await page.getByLabel('On player 1', { exact: true }).selectOption('p11');
  await page.getByRole('button', { name: 'Save next substitutions' }).click();
  await expect(lee).toHaveText('0:30');
  const actual = page
    .locator('details')
    .filter({ has: page.getByText('Playing time so far', { exact: true }) });
  await actual.locator('summary').click();
  await expect(
    actual
      .locator('.minutes > div')
      .filter({ has: page.getByText('Lee', { exact: true }) })
      .locator('strong'),
  ).toHaveText('0:00');
  await page.reload();
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await estimate.locator('summary').click();
  await expect(lee).toHaveText('0:30');
});

test('shows the first real substitutions before an unchanged opening block', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await seed(page, heldRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const upcoming = page.getByRole('list', {
    name: 'Upcoming substitutions',
    exact: true,
  });
  await expect(upcoming.getByRole('listitem')).toHaveCount(1);
  await expect(upcoming).toHaveText(/OFF\s+Blair\s+→\s+ON\s+Jules/);
  await expect(page.locator('.next-change')).toContainText('match 1:00');
  const field = page.getByRole('group', { name: 'Live lineup', exact: true });
  await expect(field.locator('.incoming-player')).toHaveText('Next Jules');
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(35_000);
  await expect(upcoming).toHaveText(/OFF\s+Blair\s+→\s+ON\s+Jules/);
  await expect(field.locator('.incoming-player')).toHaveText('Next Jules');
});

test('highlights the latest incoming players through held blocks and reload', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await seed(page, heldRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  const field = page.getByRole('group', { name: 'Live lineup', exact: true });
  await expect(field.locator('.recently-on')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume clock' }).click();
  await page.clock.runFor(65_000);
  await expect(field.locator('.recently-on')).toHaveCount(0);
  await page.getByRole('button', { name: 'Acknowledge changes' }).click();
  await expect(field.locator('.recently-on')).toHaveText('JulesJust on');
  await expect(field.locator('.recently-on')).toHaveCSS(
    'background-color',
    'rgb(220, 239, 220)',
  );
  await page.clock.runFor(35_000);
  await expect(field.locator('.recently-on')).toHaveText('JulesJust on');
  await page.reload();
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await expect(field.locator('.recently-on')).toHaveText('JulesJust on');
  await page.clock.runFor(25_000);
  await page
    .getByRole('button', { name: 'Start second half', exact: true })
    .click();
  await expect(field.locator('.recently-on')).toHaveText('BlairJust on');
});

test('edits both sides of the upcoming grid without a separate field or moving retained players', async ({
  page,
}) => {
  await seed(page, heldRun());
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await expect(page.locator('.next-change .pitch')).toHaveCount(0);
  const grid = page.getByRole('list', {
    name: 'Upcoming substitutions',
    exact: true,
  });
  await expect(grid.getByRole('listitem')).toHaveCount(1);
  await grid.getByLabel('Off player 1', { exact: true }).selectOption('p3');
  await grid.getByLabel('On player 1', { exact: true }).selectOption('p11');
  expect(
    await grid
      .getByLabel('On player 1', { exact: true })
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value)),
  ).toEqual(['p3', 'p9', 'p10', 'p11']);
  await page.getByRole('button', { name: 'Save next substitutions' }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
  );
  expect(saved.blocks[1].lineup).toEqual(saved.lineup);
  expect(saved.blocks[2].lineup).toEqual([
    'p0',
    'p1',
    'p2',
    'p11',
    'p4',
    'p5',
    'p6',
    'p7',
    'p8',
  ]);
  expect(saved.events).toHaveLength(1);
  const field = page.getByRole('group', { name: 'Live lineup', exact: true });
  await expect(
    field
      .locator('.pitch-player')
      .filter({ has: page.getByText('Drew', { exact: true }) })
      .locator('.incoming-player'),
  ).toHaveText('Next Lee');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const change of [
  {
    name: 'cancelling',
    side: 'On player 1',
    player: 'p1',
    replacement: 'p1',
    slot: 1,
  },
  {
    name: 'changing off within a chain',
    side: 'Off player 1',
    player: 'p2',
    replacement: 'p9',
    slot: 2,
  },
  {
    name: 'changing off outside a chain',
    side: 'Off player 1',
    player: 'p3',
    replacement: 'p9',
    slot: 3,
  },
]) {
  test(`keeps retained positions when ${change.name} a legacy substitution`, async ({
    page,
  }) => {
    const original = previewRun();
    await seed(page, original);
    await page.goto('/');
    await page.getByRole('button', { name: 'Resume saved game' }).click();
    await page.getByRole('button', { name: 'Edit next substitutions' }).click();
    await page
      .getByLabel(change.side, { exact: true })
      .selectOption(change.player);
    await page.getByRole('button', { name: 'Save next substitutions' }).click();
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
    );
    const expected = [...original.lineup];
    expected[6] = 'p10';
    expected[change.slot] = change.replacement;
    expect(saved.blocks[1].lineup).toEqual(expected);
    expect(saved.lineup).toEqual(original.lineup);
    expect(saved.events).toEqual(original.events);
  });
}

test('protects inline edits when an actual correction changes the live lineup', async ({
  page,
}) => {
  await seed(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await page.getByLabel('On player 1', { exact: true }).selectOption('p11');
  const correction = page
    .locator('details')
    .filter({ has: page.getByText('Adjust actual lineup', { exact: true }) });
  await correction.locator('summary').click();
  await correction
    .getByLabel('Player in field slot 3', { exact: true })
    .selectOption('p10');
  await correction.getByRole('button', { name: 'Apply actual lineup' }).click();
  await expect(
    page.getByRole('button', { name: 'Save next substitutions' }),
  ).toBeDisabled();
  await expect(page.getByLabel('On player 1', { exact: true })).toHaveValue(
    'p11',
  );
  await expect(page.getByLabel('On player 1', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Use next planned block' }).click();
  await expect(
    page.getByRole('button', { name: 'Save next substitutions' }),
  ).toBeEnabled();
});

test('adds a substitution in the grid when the next block has no bench changes', async ({
  page,
}) => {
  const original = heldRun();
  original.blocks = original.blocks.map((block) => ({
    ...block,
    lineup: [...original.lineup],
  }));
  await seed(page, original);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume saved game' }).click();
  await expect(page.locator('.next-change')).toContainText('No bench changes');
  await page.getByRole('button', { name: 'Edit next substitutions' }).click();
  await page
    .getByRole('button', { name: 'Add substitution', exact: true })
    .click();
  await page.getByLabel('On player 1', { exact: true }).selectOption('p11');
  await page.getByRole('button', { name: 'Save next substitutions' }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('soccersub.v1')!).active,
  );
  expect(saved.blocks[4].lineup).toEqual([
    'p0',
    'p11',
    ...original.lineup.slice(2),
  ]);
  expect(saved.lineup).toEqual(original.lineup);
  expect(saved.events).toEqual(original.events);
  await expect(page.locator('.next-change .pitch')).toHaveCount(0);
});
