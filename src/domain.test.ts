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
  substitutions,
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
  blocks: [
    { at: 0, lineup: players.slice(0, 9).map((player) => player.id) },
    {
      at: 900,
      lineup: [
        'player-0',
        'player-9',
        ...players.slice(2, 9).map((player) => player.id),
      ],
    },
    {
      at: 1200,
      lineup: [
        'player-1',
        'player-9',
        ...players.slice(2, 9).map((player) => player.id),
      ],
    },
    {
      at: 2100,
      lineup: [
        'player-1',
        'player-9',
        'player-10',
        ...players.slice(3, 9).map((player) => player.id),
      ],
    },
  ],
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
  it('limits each generated change to at most three incoming substitutes', () => {
    const squad: Player[] = Array.from({ length: 18 }, (_, index) => ({
      id: `squad-${index}`,
      name: `Player ${index}`,
      number: '',
      roles: index < 2 ? ['goalkeeper'] : [],
    }));
    for (const item of formations) {
      const blocks = generateBlocks(squad, item.id, 3600, 300);
      for (let index = 1; index < blocks.length; index++) {
        const previous = blocks[index - 1].lineup;
        expect(
          blocks[index].lineup.filter((id) => !previous.includes(id)).length,
          `${item.id}, block ${index}`,
        ).toBeLessThanOrEqual(3);
      }
      expect(
        Object.values(plannedSeconds(blocks, 3600, squad)).reduce(
          (sum, value) => sum + value,
          0,
        ),
      ).toBe(item.size * 3600);
    }
  });
  it('keeps players on for two consecutive blocks before rotating them off', () => {
    for (const item of formations) {
      const blocks = generateBlocks(players, item.id, 3600, 300);
      expect(blocks[1].lineup).toEqual(blocks[0].lineup);
      const stints = new Map(blocks[0].lineup.map((id) => [id, 1]));
      for (let index = 1; index < blocks.length; index++) {
        const previous = blocks[index - 1].lineup;
        const next = blocks[index].lineup;
        for (const id of previous.filter((id) => !next.includes(id))) {
          const keeperChange = blocks[index].at === 1800 && id === previous[0];
          if (!keeperChange)
            expect(
              stints.get(id),
              `${item.id}, block ${index}, ${id}`,
            ).toBeGreaterThanOrEqual(2);
          stints.delete(id);
        }
        for (const id of next)
          stints.set(id, previous.includes(id) ? (stints.get(id) ?? 0) + 1 : 1);
      }
    }
  });
  it('keeps retained players in their slots across all generated presets', () => {
    for (const item of formations) {
      for (const start of [
        undefined,
        players
          .slice(0, item.size)
          .map((player) => player.id)
          .reverse(),
      ]) {
        const blocks = generateBlocks(players, item.id, 2400, 300, start);
        for (let index = 1; index < blocks.length; index++) {
          const previous = blocks[index - 1].lineup;
          const next = blocks[index].lineup;
          previous.forEach((id, slot) => {
            const keeperChange =
              blocks[index].at === 1200 &&
              (id === previous[0] || id === next[0]);
            if (next.includes(id) && !keeperChange)
              expect(
                next.indexOf(id),
                `${item.id}, block ${index}, ${id}`,
              ).toBe(slot);
          });
        }
      }
    }
  });
  it('makes no outfield position changes when there is no bench', () => {
    const squad = players.slice(0, 9);
    const blocks = generateBlocks(squad, '9:3-2-3', 2400, 300);
    const start = blocks[0].lineup;
    for (const block of blocks.filter((block) => block.at < 1200))
      expect(block.lineup).toEqual(start);
    const halftime = [...start];
    const keeperSlot = start.indexOf('player-1');
    [halftime[0], halftime[keeperSlot]] = [halftime[keeperSlot], halftime[0]];
    for (const block of blocks.filter((block) => block.at >= 1200))
      expect(block.lineup).toEqual(halftime);
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
  it('keeps a corrected goalkeeper for the remaining first half only', () => {
    const original = run();
    original.clock.elapsed = 100;
    const corrected = acknowledge(original, [
      'player-10',
      ...original.lineup.slice(1),
    ]);
    expect(corrected.blocks[1].lineup[0]).toBe('player-10');
    expect(corrected.blocks[0]).toEqual(original.blocks[0]);
    expect(corrected.blocks.slice(2)).toEqual(original.blocks.slice(2));
    expect(corrected.events[0]).toEqual(original.events[0]);
  });
  it('keeps an edited halftime goalkeeper through the second half', () => {
    const original = run();
    original.clock = { phase: 'halftime', elapsed: 1200, anchor: null };
    const target = ['player-11', ...original.blocks[2].lineup.slice(1)];
    const restarted = startSecondHalf(original, 1000, target);
    expect(restarted.blocks[3].lineup[0]).toBe('player-11');
    expect(restarted.blocks.slice(0, 2)).toEqual(original.blocks.slice(0, 2));
  });
  it('pairs outgoing players with bench entrants through position moves', () => {
    expect(
      substitutions(['a', 'b', 'c', 'd', 'e'], ['b', 'x', 'd', 'y', 'e']),
    ).toEqual([
      { off: 'a', on: 'x' },
      { off: 'c', on: 'y' },
    ]);
    expect(substitutions(['a', 'b', 'c', 'd'], ['b', 'c', 'x', 'd'])).toEqual([
      { off: 'a', on: 'x' },
    ]);
  });
  it('does not show substitutions for unchanged lineups or position swaps', () => {
    expect(substitutions(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    expect(substitutions(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([]);
  });
  it('preserves an already-pending change when recovering the saved game', () => {
    const due = advance(toggleClock(run(), 1000), 951000);
    const recovered = advance(due, 961000, true);
    expect(recovered.pendingBlock).toBe(1);
    expect(recovered.lineup).toEqual(due.lineup);
    expect(recovered.events).toEqual(due.events);
    expect(recovered.notice?.missed).toBe(0);
  });
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
