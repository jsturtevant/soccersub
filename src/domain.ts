import { z } from 'zod';

export const roles = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
] as const;
export type Role = (typeof roles)[number];

export const formations = [
  { size: 7, layouts: ['2-3-1', '3-2-1', '3-1-2'] },
  { size: 9, layouts: ['3-3-2', '4-3-1', '3-2-3', '3-4-1', '4-2-2'] },
  {
    size: 11,
    layouts: ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-1-4-1', '4-2-2-2'],
  },
].flatMap(({ size, layouts }) =>
  layouts.map((layout) => ({
    id: `${size}:${layout}`,
    size,
    layout,
    rows: layout.split('-').map(Number),
  })),
);

export function formation(id: string) {
  const value = formations.find((item) => item.id === id);
  if (!value) throw new Error('Choose a supported formation.');
  return value;
}

export function slotRoles(id: string): Role[] {
  const { rows } = formation(id);
  return [
    'goalkeeper',
    ...rows.flatMap((count, index): Role[] => {
      const role =
        index === 0
          ? 'defender'
          : index === rows.length - 1
            ? 'forward'
            : 'midfielder';
      return Array<Role>(count).fill(role);
    }),
  ];
}

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(80);
const duration = z
  .number()
  .int()
  .min(120)
  .max(14400)
  .refine((n) => n % 2 === 0);
const interval = z.number().int().min(30).max(7200);
const seconds = z.number().finite().nonnegative();
export const playerSchema = z.object({
  id,
  name,
  number: z.string().max(6),
  roles: z
    .array(z.enum(roles))
    .max(4)
    .refine((items) => new Set(items).size === items.length),
});
export type Player = z.infer<typeof playerSchema>;
export const blockSchema = z.object({
  at: seconds,
  lineup: z.array(id).min(7).max(11),
});
export type Block = z.infer<typeof blockSchema>;

const planShape = {
  formationId: z
    .string()
    .refine((value) => formations.some((item) => item.id === value)),
  duration,
  interval,
  blocks: z.array(blockSchema).min(2).max(480),
};

export const templateSchema = z.object({ id, name, ...planShape });
export type Template = z.infer<typeof templateSchema>;
export const teamSchema = z.object({
  id,
  name,
  archived: z.boolean(),
  players: z.array(playerSchema).max(100),
  templates: z.array(templateSchema).max(200),
});
export type Team = z.infer<typeof teamSchema>;

const eventSchema = z.object({
  at: seconds,
  lineup: z.array(id).min(7).max(11),
  source: z.enum(['planned', 'coach', 'assumed']),
});

export const runSchema = z.object({
  id,
  teamId: id,
  teamName: name,
  templateId: id,
  templateName: name,
  players: z.array(playerSchema).min(7).max(100),
  ...planShape,
  clock: z.object({
    phase: z.enum(['first', 'halftime', 'second', 'fulltime']),
    elapsed: seconds,
    anchor: z.number().finite().nonnegative().nullable(),
  }),
  lineup: z.array(id).min(7).max(11),
  events: z.array(eventSchema).min(1).max(10000),
  appliedBlock: z.number().int().nonnegative(),
  pendingBlock: z.number().int().nonnegative().nullable(),
  notice: z
    .object({
      from: z.array(id),
      to: z.array(id),
      missed: z.number().int().nonnegative(),
    })
    .nullable(),
  date: z.iso.date(),
  opponent: z.string().max(80),
});
export type Run = z.infer<typeof runSchema>;
export const matchSchema = z.object({
  run: runSchema,
  scoreFor: z.number().int().min(0).max(999).nullable(),
  scoreAgainst: z.number().int().min(0).max(999).nullable(),
  notes: z.string().max(2000),
});
export type Match = z.infer<typeof matchSchema>;

export const stateSchema = z.object({
  version: z.literal(1),
  teams: z.array(teamSchema).max(100),
  history: z.array(matchSchema).max(2000),
  active: runSchema.nullable(),
});
export type AppState = z.infer<typeof stateSchema>;
export const emptyState = (): AppState => ({
  version: 1,
  teams: [],
  history: [],
  active: null,
});
export const uid = () => crypto.randomUUID();

export function boundaries(total: number, step: number): number[] {
  duration.parse(total);
  interval.parse(step);
  const half = total / 2;
  const times: number[] = [];
  for (const start of [0, half]) {
    for (let at = start; at < start + half; at += step) times.push(at);
  }
  return times;
}

export function validateLineup(
  lineup: string[],
  players: Player[],
  formationId: string,
) {
  const ids = new Set(players.map((player) => player.id));
  if (
    lineup.length !== formation(formationId).size ||
    new Set(lineup).size !== lineup.length ||
    lineup.some((value) => !ids.has(value))
  ) {
    throw new Error('Each field position needs a different available player.');
  }
}

export function validatePlan(
  plan: Pick<Template, 'formationId' | 'duration' | 'interval' | 'blocks'>,
  players: Player[],
) {
  const times = boundaries(plan.duration, plan.interval);
  if (
    plan.blocks.length !== times.length ||
    plan.blocks.some((block, index) => block.at !== times[index])
  ) {
    throw new Error(
      'Lineup blocks must cover both halves at the chosen interval.',
    );
  }
  for (const block of plan.blocks)
    validateLineup(block.lineup, players, plan.formationId);
}

function uniqueIds(items: { id: string }[], label: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error(`${label} contain duplicate IDs.`);
  }
}

export function parseState(input: unknown): AppState {
  const state = stateSchema.parse(input);
  uniqueIds(state.teams, 'Teams');
  uniqueIds(
    state.history.map((match) => match.run),
    'Games',
  );
  for (const team of state.teams) {
    uniqueIds(team.players, 'Players');
    uniqueIds(team.templates, 'Plans');
    for (const template of team.templates) validatePlan(template, team.players);
  }
  for (const run of [
    ...state.history.map((match) => match.run),
    ...(state.active ? [state.active] : []),
  ]) {
    uniqueIds(run.players, 'Game players');
    validatePlan(run, run.players);
    validateLineup(run.lineup, run.players, run.formationId);
    if (
      run.clock.elapsed > run.duration ||
      run.appliedBlock >= run.blocks.length ||
      (run.pendingBlock !== null && run.pendingBlock >= run.blocks.length) ||
      run.events[0].at !== 0 ||
      run.events.some(
        (event, index) =>
          event.at > run.clock.elapsed ||
          (index > 0 && event.at < run.events[index - 1].at),
      )
    )
      throw new Error('Saved game timing is invalid.');
    for (const event of run.events)
      validateLineup(event.lineup, run.players, run.formationId);
    if (
      run.events
        .at(-1)
        ?.lineup.some((player, index) => player !== run.lineup[index])
    ) {
      throw new Error('The current lineup must match the actual event log.');
    }
    if (
      run.pendingBlock !== null &&
      run.pendingBlock !== run.appliedBlock + 1
    ) {
      throw new Error('The pending block must follow the applied block.');
    }
    const { phase, elapsed, anchor } = run.clock;
    if (
      (phase === 'first' && elapsed > run.duration / 2) ||
      (phase === 'halftime' &&
        (elapsed !== run.duration / 2 || anchor !== null)) ||
      (phase === 'second' &&
        (elapsed < run.duration / 2 || elapsed >= run.duration)) ||
      (phase === 'fulltime' && (elapsed !== run.duration || anchor !== null))
    )
      throw new Error('Saved game phase is invalid.');
  }
  if (
    state.active &&
    !state.teams.some((team) => team.id === state.active?.teamId)
  ) {
    throw new Error('The active game needs its team.');
  }
  if (state.history.some((match) => match.run.clock.phase !== 'fulltime')) {
    throw new Error('History can contain only completed games.');
  }
  return state;
}

export function keepGoalkeeper<
  T extends Pick<Template, 'formationId' | 'duration' | 'interval' | 'blocks'>,
>(plan: T, keeper: string, from: number, until: number): T {
  const next = structuredClone(plan);
  for (const block of next.blocks) {
    if (block.at < from || block.at >= until) continue;
    const slot = block.lineup.indexOf(keeper);
    if (slot > 0) block.lineup[slot] = block.lineup[0];
    block.lineup[0] = keeper;
  }
  return next;
}

export function editBlock<
  T extends Pick<Template, 'formationId' | 'duration' | 'interval' | 'blocks'>,
>(plan: T, index: number, lineup: string[], players: Player[]): T {
  if (!Number.isInteger(index) || !plan.blocks[index])
    throw new Error('Choose a valid lineup block.');
  validateLineup(lineup, players, plan.formationId);
  let next = structuredClone(plan);
  const block = next.blocks[index];
  const keeperChanged = block.lineup[0] !== lineup[0];
  block.lineup = [...lineup];
  if (keeperChanged)
    next = keepGoalkeeper(
      next,
      lineup[0],
      block.at,
      block.at < plan.duration / 2 ? plan.duration / 2 : plan.duration,
    );
  validatePlan(next, players);
  return next;
}

export function plannedSeconds(
  blocks: Block[],
  total: number,
  players: Player[],
): Record<string, number> {
  const result = Object.fromEntries(players.map((player) => [player.id, 0]));
  blocks.forEach((block, index) => {
    const length = (blocks[index + 1]?.at ?? total) - block.at;
    block.lineup.forEach((player) => {
      result[player] += length;
    });
  });
  return result;
}

export function rotationWarnings(
  plan: Pick<Template, 'duration' | 'blocks'>,
  players: Player[],
): string[] {
  const warnings: string[] = [];
  for (const [start, label] of [
    [0, 'first'],
    [plan.duration / 2, 'second'],
  ] as const) {
    const played = new Set(
      plan.blocks
        .filter(
          (block) => block.at >= start && block.at < start + plan.duration / 2,
        )
        .flatMap((block) => block.lineup),
    );
    const missing = players.filter((player) => !played.has(player.id));
    if (missing.length)
      warnings.push(
        `No ${label}-half playing time: ${missing.map((player) => player.name).join(', ')}.`,
      );
  }
  const waiting = players.filter((player) =>
    plan.blocks.some(
      (block, index) =>
        index > 0 &&
        !block.lineup.includes(player.id) &&
        !plan.blocks[index - 1].lineup.includes(player.id),
    ),
  );
  if (waiting.length)
    warnings.push(
      `Consecutive bench blocks: ${waiting.map((player) => player.name).join(', ')}.`,
    );
  return warnings;
}

export function generateBlocks(
  players: Player[],
  formationId: string,
  total: number,
  step: number,
  start?: string[],
): Block[] {
  const slots = slotRoles(formationId);
  if (players.length < slots.length)
    throw new Error(`Select at least ${slots.length} available players.`);
  uniqueIds(players, 'Players');
  if (start) validateLineup(start, players, formationId);
  const minutes = Object.fromEntries(players.map((player) => [player.id, 0]));
  const stints = Object.fromEntries(players.map((player) => [player.id, 0]));
  const benchBlocks = Object.fromEntries(
    players.map((player) => [player.id, 0]),
  );
  const playedThisHalf = new Set<string>();
  const preferred = players.filter((player) =>
    player.roles.includes('goalkeeper'),
  );
  const firstKeeper = start?.[0] ?? preferred[0]?.id ?? players[0].id;
  const secondKeeper =
    preferred.find((player) => player.id !== firstKeeper)?.id ?? firstKeeper;
  const times = boundaries(total, step);
  let previous: string[] | undefined;
  return times.map((at, index) => {
    if (at === total / 2) playedThisHalf.clear();
    const keeper = at < total / 2 ? firstKeeper : secondKeeper;
    const lineup =
      index === 0 && start
        ? [...start]
        : previous
          ? [...previous]
          : Array<string>(slots.length).fill('');
    if (!(index === 0 && start)) {
      const keeperSlot = lineup.indexOf(keeper);
      if (keeperSlot > 0) lineup[keeperSlot] = lineup[0];
      lineup[0] = keeper;
      const candidates = players
        .filter((player) => player.id !== keeper)
        .sort(
          (a, b) =>
            Number(playedThisHalf.has(a.id)) -
              Number(playedThisHalf.has(b.id)) ||
            benchBlocks[b.id] - benchBlocks[a.id] ||
            Number(previous?.includes(b.id) && stints[b.id] < 2) -
              Number(previous?.includes(a.id) && stints[a.id] < 2) ||
            minutes[a.id] - minutes[b.id] ||
            Number(previous?.includes(b.id)) -
              Number(previous?.includes(a.id)) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, slots.length - 1);
      const selected = new Set(candidates.map((player) => player.id));
      const incoming = candidates.filter(
        (player) => !lineup.slice(1).includes(player.id),
      );
      for (let slot = 1; slot < slots.length; slot++) {
        if (selected.has(lineup[slot])) continue;
        incoming.sort(
          (a, b) =>
            Number(b.roles.includes(slots[slot])) -
              Number(a.roles.includes(slots[slot])) ||
            minutes[a.id] - minutes[b.id] ||
            a.id.localeCompare(b.id),
        );
        const next = incoming.shift();
        if (!next)
          throw new Error('Not enough players to fill this formation.');
        lineup[slot] = next.id;
      }
    }
    const length = (times[index + 1] ?? total) - at;
    lineup.forEach((player) => {
      minutes[player] += length;
      stints[player] = previous?.includes(player) ? stints[player] + 1 : 1;
      playedThisHalf.add(player);
    });
    for (const player of players)
      benchBlocks[player.id] = lineup.includes(player.id)
        ? 0
        : benchBlocks[player.id] + 1;
    previous = lineup;
    return { at, lineup };
  });
}

export const formatTime = (value: number) => {
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
