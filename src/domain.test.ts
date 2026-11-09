import { describe, expect, it } from 'vitest';
import {
  boundaries,
  emptyState,
  formations,
  generateBlocks,
  parseState,
  plannedSeconds,
  slotRoles,
  type Player,
  type Template,
} from './domain';
import {
  acknowledge,
  actualSeconds,
  advance,
  createRun,
  startSecondHalf,
  toggleClock,
} from './engine';
import { exportBackup, importBackup } from './storage';

const players: Player[] = Array.from({ length: 12 }, (_, index) => ({
  id: `player-${index}`,
  name: `Player ${index}`,
  number: '',
  roles: index < 2 ? ['goalkeeper'] : [],
}));
const template = (): Template => ({
  id: 'plan',
  name: 'Match plan',
  formationId: '9:3-2-3',
  duration: 2400,
  interval: 900,
  blocks: generateBlocks(players, '9:3-2-3', 2400, 900),
});
const run = () =>
  createRun(
    { id: 'team', name: 'Team' },
    template(),
    players,
    '2026-11-08',
    '',
  );

describe('lineup planning', () => {
  it('restarts intervals in each half and includes shorter final blocks', () => {
    expect(boundaries(2400, 900)).toEqual([0, 900, 1200, 2100]);
  });
  it('fills all preset positions with unique available players and swaps keepers at halftime', () => {
    for (const item of formations) {
      expect(slotRoles(item.id)).toHaveLength(item.size);
      const blocks = generateBlocks(players, item.id, 2400, 900);
      expect(
        blocks.every((block) => new Set(block.lineup).size === item.size),
      ).toBe(true);
      expect(blocks[0].lineup[0]).toBe('player-0');
      expect(blocks[1].lineup[0]).toBe('player-0');
      expect(blocks[2].lineup[0]).toBe('player-1');
    }
  });
  it('balances even-length outfield rotations without losing field minutes', () => {
    const blocks = generateBlocks(players, '9:3-2-3', 2400, 300);
    const totals = plannedSeconds(blocks, 2400, players);
    expect(Object.values(totals).reduce((sum, n) => sum + n, 0)).toBe(2400 * 9);
    const outfield = players.slice(2).map((player) => totals[player.id]);
    expect(Math.max(...outfield) - Math.min(...outfield)).toBeLessThanOrEqual(
      300,
    );
  });
  it('rejects incomplete squads and duplicate starting players', () => {
    expect(() =>
      generateBlocks(players.slice(0, 8), '9:3-2-3', 2400, 900),
    ).toThrow('at least 9');
    expect(() =>
      generateBlocks(players, '9:3-2-3', 2400, 900, Array(9).fill('player-0')),
    ).toThrow('different');
  });
});

describe('game clock and actual lineups', () => {
  it('stops at halftime even after long background time and requires manual restart', () => {
    const first = toggleClock(run(), 1000);
    const half = advance(first, 9_000_000, true);
    expect(half.clock).toEqual({
      phase: 'halftime',
      elapsed: 1200,
      anchor: null,
    });
    expect(half.appliedBlock).toBe(1);
    const second = startSecondHalf(half, 10_000_000);
    expect(second.lineup[0]).toBe('player-1');
    expect(advance(second, 20_000_000, true).clock).toEqual({
      phase: 'fulltime',
      elapsed: 2400,
      anchor: null,
    });
  });
  it('does not count pauses toward playing time', () => {
    const paused = toggleClock(toggleClock(run(), 1000), 101000);
    expect(advance(paused, 9_000_000).clock.elapsed).toBe(100);
    const resumed = toggleClock(paused, 10_000_000);
    expect(advance(resumed, 10_010_000).clock.elapsed).toBe(110);
  });
  it('keeps the actual lineup until acknowledgement and records the real change time', () => {
    const original = run();
    const due = advance(toggleClock(original, 1000), 951000);
    expect(due.pendingBlock).toBe(1);
    expect(due.lineup).toEqual(original.lineup);
    const accepted = acknowledge(due);
    expect(accepted.events.at(-1)?.at).toBe(950);
    expect(
      Object.values(actualSeconds(accepted)).reduce((sum, n) => sum + n, 0),
    ).toBe(950 * 9);
  });
  it('saves assumed changes on catch-up and lets the coach correct the current lineup', () => {
    const due = advance(toggleClock(run(), 1000), 951000, true);
    expect(due.pendingBlock).toBeNull();
    expect(due.notice?.missed).toBe(1);
    expect(due.events.at(-1)?.at).toBe(900);
    const changed = [...due.lineup].reverse();
    const accepted = acknowledge(due, changed);
    expect(accepted.events.at(-1)).toMatchObject({
      source: 'coach',
      at: 950,
      lineup: changed,
    });
  });
  it('snapshots templates and players independently', () => {
    const plan = template();
    const snapshot = createRun(
      { id: 'team', name: 'Team' },
      plan,
      players,
      '2026-11-08',
      '',
    );
    plan.blocks[0].lineup.reverse();
    expect(snapshot.blocks[0].lineup).not.toEqual(plan.blocks[0].lineup);
  });
});

describe('validated backups', () => {
  const populated = () => ({
    ...emptyState(),
    teams: [
      {
        id: 'team',
        name: 'Team',
        archived: false,
        players,
        templates: [template()],
      },
    ],
  });
  it('excludes active games and restores completed data only', () => {
    const state = { ...populated(), active: run() };
    const backup = importBackup(exportBackup(state), null);
    expect(backup.active).toBeNull();
    expect(backup.teams).toEqual(state.teams);
    expect(() => importBackup(exportBackup(state), state.active)).toThrow(
      'active game',
    );
  });
  it('rejects invalid lineup references, duplicate IDs, and broken timing', () => {
    const state = populated();
    state.teams[0].templates[0].blocks[0].lineup[0] = 'missing';
    expect(() => parseState(state)).toThrow('different available');
    expect(() =>
      parseState({
        ...populated(),
        teams: [populated().teams[0], populated().teams[0]],
      }),
    ).toThrow('duplicate');
    const active = run();
    active.clock.elapsed = 99999;
    expect(() => parseState({ ...populated(), active })).toThrow('timing');
  });
  it('rejects a current lineup that disagrees with the actual event log', () => {
    const active = run();
    active.lineup = [...active.lineup].reverse();
    expect(() => parseState({ ...populated(), active })).toThrow('event log');
  });
  it('rejects a pending block that would replay an already applied block', () => {
    const active = run();
    active.clock = { phase: 'second', elapsed: 1500, anchor: null };
    active.appliedBlock = 2;
    active.pendingBlock = 1;
    expect(() => parseState({ ...populated(), active })).toThrow('pending');
  });
  it('rejects a second-half clock already at full time', () => {
    const active = run();
    active.clock = { phase: 'second', elapsed: active.duration, anchor: null };
    expect(() => parseState({ ...populated(), active })).toThrow('phase');
  });
});
