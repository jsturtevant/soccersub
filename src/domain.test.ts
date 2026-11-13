import { describe, expect, it } from 'vitest';
import {
  boundaries,
  emptyState,
  editBlock,
  formations,
  generateBlocks,
  parseState,
  parseCustomTimes,
  plannedSeconds,
  rotationWarnings,
  slotRoles,
  validatePlan,
  type Player,
  type Template,
} from './domain';
import {
  acknowledge,
  actualSeconds,
  advance,
  createRun,
  editNextBlock,
  estimatedSeconds,
  nextBlockIndex,
  nextSubstitutionIndex,
  startSecondHalf,
  substitutions,
  substitutionLineup,
  toggleClock,
} from './engine';
import { exportBackup, importBackup } from './storage';
import { rotationStrategyIds } from './rotations';

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
  it('fills manual schedules with independent copies of one lineup and no goalkeeper swap', () => {
    const start = players.slice(0, 9).map((player) => player.id);
    for (const customTimes of [undefined, [0, 300, 1050, 1200, 1620]]) {
      const blocks = generateBlocks(
        players,
        '9:3-2-3',
        2400,
        300,
        start,
        'manual',
        customTimes,
      );
      expect(blocks.map((block) => block.at)).toEqual(
        customTimes ?? boundaries(2400, 300),
      );
      expect(
        blocks.every((block) => block.lineup.join() === start.join()),
      ).toBe(true);
      blocks[0].lineup[1] = 'player-11';
      expect(blocks[1].lineup).toEqual(start);
    }
    const automaticStart = generateBlocks(
      players,
      '9:3-2-3',
      2400,
      300,
      undefined,
      'manual',
    );
    expect(
      automaticStart.every(
        (block) => block.lineup.join() === automaticStart[0].lineup.join(),
      ),
    ).toBe(true);
  });
  it('validates custom per-half times and rejects unordered or unsafe schedules', () => {
    expect(parseCustomTimes(2400, '5, 17.5', '7, 15')).toEqual([
      0, 300, 1050, 1200, 1620, 2100,
    ]);
    expect(parseCustomTimes(2400, '', '')).toEqual([0, 1200]);
    for (const text of [
      '0',
      '20',
      '21',
      '-1',
      'NaN',
      '5,',
      '5,5',
      '10,5',
      '0.1',
      '5,5.1',
      '1e1',
    ])
      expect(() => parseCustomTimes(2400, text, '')).toThrow();
    for (const custom of [
      [0, 300],
      [0, 1200, 2400],
      [0, 1200, 1210],
      [0, 1200, NaN],
    ]) {
      expect(() => boundaries(2400, 300, custom)).toThrow();
    }
    expect(() =>
      validatePlan(
        {
          ...template(),
          customTimes: [0, 1200],
        },
        players,
      ),
    ).toThrow('advanced manual');
  });
  it('carries manual edits only through untouched blocks, including goalkeeper edits', () => {
    const original: Template = {
      ...template(),
      strategy: 'manual',
      interval: 300,
      blocks: generateBlocks(
        players,
        '9:3-2-3',
        2400,
        300,
        players.slice(0, 9).map((player) => player.id),
        'manual',
      ),
    };
    const start = original.blocks[0].lineup;
    const pinned = editBlock(original, 5, start, players, true);
    const changed = ['player-11', ...start.slice(1)];
    const edited = editBlock(pinned, 1, changed, players, true);
    expect(
      edited.blocks
        .slice(1, 5)
        .every((block) => block.lineup.join() === changed.join()),
    ).toBe(true);
    expect(
      edited.blocks
        .slice(5)
        .every((block) => block.lineup.join() === start.join()),
    ).toBe(true);
    expect(edited.blocks[1].edited).toBe(true);
    expect(edited.blocks[2].edited).toBeUndefined();
    const explicit = editBlock(edited, 2, start, players);
    expect(explicit.blocks[3].lineup).toEqual(changed);
    expect(
      original.blocks.every((block) => block.lineup.join() === start.join()),
    ).toBe(true);
  });
  it('keeps the existing fair generator as the default strategy', () => {
    expect(generateBlocks(players, '9:3-2-3', 2400, 300)).toEqual(
      generateBlocks(players, '9:3-2-3', 2400, 300, undefined, 'fair'),
    );
  });
  it('limits small changes and longer shifts without moving retained players', () => {
    const squad: Player[] = Array.from({ length: 18 }, (_, index) => ({
      id: `squad-${index}`,
      name: `Player ${index}`,
      number: '',
      roles: index < 2 ? ['goalkeeper'] : [],
    }));
    for (const strategy of rotationStrategyIds.filter(
      (id) => id !== 'fair' && id !== 'manual',
    )) {
      for (const item of formations) {
        const blocks = generateBlocks(
          squad,
          item.id,
          3600,
          300,
          undefined,
          strategy,
        );
        const stints = new Map(blocks[0].lineup.map((id) => [id, 1]));
        for (let index = 1; index < blocks.length; index++) {
          const previous = blocks[index - 1].lineup;
          const next = blocks[index].lineup;
          expect(
            next.filter((id) => !previous.includes(id)).length,
          ).toBeLessThanOrEqual(3);
          for (const id of previous) {
            const keeperSwap =
              blocks[index].at === 1800 &&
              (id === previous[0] || id === next[0]);
            if (next.includes(id) && !keeperSwap)
              expect(next.indexOf(id)).toBe(previous.indexOf(id));
            if (
              !next.includes(id) &&
              strategy === 'longer-shifts' &&
              !keeperSwap
            )
              expect(stints.get(id)).toBeGreaterThanOrEqual(2);
          }
          for (const id of next)
            stints.set(
              id,
              previous.includes(id) ? (stints.get(id) ?? 0) + 1 : 1,
            );
        }
        if (strategy === 'longer-shifts')
          expect(blocks[1].lineup).toEqual(blocks[0].lineup);
        else expect(blocks[1].lineup).not.toEqual(blocks[0].lineup);
      }
    }
  });
  it('resolves future goalkeeper duplicates without moving other players', () => {
    const original = template();
    const next = editBlock(
      original,
      0,
      ['player-9', ...original.blocks[0].lineup.slice(1)],
      players,
    );
    expect(next.blocks[1].lineup).toEqual([
      'player-9',
      'player-0',
      ...original.blocks[1].lineup.slice(2),
    ]);
    expect(next.blocks.slice(2)).toEqual(original.blocks.slice(2));
    expect(original.blocks[0].lineup[0]).toBe('player-0');
  });
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
  it('gives every player a turn in each half when two blocks can cover the squad', () => {
    for (const item of formations) {
      const blocks = generateBlocks(players, item.id, 2400, 900);
      for (const start of [0, 1200]) {
        const played = new Set(
          blocks
            .filter((block) => block.at >= start && block.at < start + 1200)
            .flatMap((block) => block.lineup),
        );
        expect(
          players.filter((player) => !played.has(player.id)),
          `${item.id}, half starting ${start}`,
        ).toEqual([]);
      }
    }
  });
  it('never benches a player for consecutive blocks when the squad fits that goal', () => {
    for (const item of formations) {
      const blocks = generateBlocks(players, item.id, 3600, 300);
      for (let index = 1; index < blocks.length; index++)
        expect(
          players.filter(
            (player) =>
              !blocks[index - 1].lineup.includes(player.id) &&
              !blocks[index].lineup.includes(player.id),
          ),
          `${item.id}, block ${index}`,
        ).toEqual([]);
    }
  });
  it('covers each half in a large squad even when one-block bench waits are impossible', () => {
    const squad: Player[] = Array.from({ length: 18 }, (_, index) => ({
      id: `large-${index}`,
      name: `Player ${index}`,
      number: '',
      roles: index < 2 ? ['goalkeeper'] : [],
    }));
    const plan = {
      duration: 3600,
      blocks: generateBlocks(squad, '7:2-3-1', 3600, 600),
    };
    expect(rotationWarnings(plan, squad)).toEqual([
      expect.stringMatching(/^Consecutive bench blocks:/),
    ]);
  });
  it('keeps changes within three substitutes when the bench fits that limit', () => {
    for (const item of formations) {
      const squad: Player[] = Array.from(
        { length: item.size + 3 },
        (_, index) => ({
          id: `squad-${index}`,
          name: `Player ${index}`,
          number: '',
          roles: index < 2 ? ['goalkeeper'] : [],
        }),
      );
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
  it('prefers two-block stints after the opening rotation when bench size permits', () => {
    for (const item of formations.filter(
      (item) => players.length - item.size <= Math.floor((item.size - 1) / 2),
    )) {
      const blocks = generateBlocks(players, item.id, 3600, 300);
      const stints = new Map(blocks[0].lineup.map((id) => [id, 1]));
      for (let index = 1; index < blocks.length; index++) {
        const previous = blocks[index - 1].lineup;
        const next = blocks[index].lineup;
        for (const id of previous.filter((id) => !next.includes(id))) {
          const keeperChange = blocks[index].at === 1800 && id === previous[0];
          if (!keeperChange && index > 1)
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
  it('warns about impossible short halves and consecutive bench waits in edited plans', () => {
    const short = {
      duration: 120,
      blocks: generateBlocks(players, '9:3-2-3', 120, 60),
    };
    expect(rotationWarnings(short, players)).toEqual([
      expect.stringMatching(/^No first-half playing time:/),
      expect.stringMatching(/^No second-half playing time:/),
    ]);
    const edited = template();
    edited.blocks = edited.blocks.map((block) => ({
      ...block,
      lineup: [...edited.blocks[0].lineup],
    }));
    expect(rotationWarnings(edited, players)).toEqual([
      'No first-half playing time: Player 9, Player 10, Player 11.',
      'No second-half playing time: Player 9, Player 10, Player 11.',
      'Consecutive bench blocks: Player 9, Player 10, Player 11.',
    ]);
    expect(
      rotationWarnings(
        {
          duration: 2400,
          blocks: generateBlocks(players, '9:3-2-3', 2400, 900),
        },
        players,
      ),
    ).toEqual([]);
  });
});

describe('game clock and actual lineups', () => {
  it('runs irregular manual boundaries without inventing interval blocks or changing actual play early', () => {
    let plan: Template = {
      ...template(),
      strategy: 'manual',
      duration: 240,
      interval: 30,
      customTimes: [0, 30, 90, 120, 165],
      blocks: generateBlocks(
        players,
        '9:3-2-3',
        240,
        30,
        players.slice(0, 9).map((player) => player.id),
        'manual',
        [0, 30, 90, 120, 165],
      ),
    };
    plan = editBlock(
      plan,
      1,
      ['player-0', 'player-9', ...plan.blocks[0].lineup.slice(2)],
      players,
      true,
    );
    const original = createRun(
      { id: 'team', name: 'Team' },
      plan,
      players,
      '2026-11-13',
      '',
    );
    const due = advance(toggleClock(original, 1000), 36000);
    expect(due.pendingBlock).toBe(1);
    expect(due.lineup).toEqual(original.lineup);
    const applied = acknowledge(due);
    const held = advance(applied, 66000);
    expect(held.appliedBlock).toBe(1);
    expect(held.events.at(-1)?.at).toBe(35);
    const half = advance(held, 121000);
    expect(half.clock.phase).toBe('halftime');
    const second = startSecondHalf(half, 200000);
    expect(second.lineup).toEqual(applied.lineup);
    expect(advance(second, 246000).appliedBlock).toBe(4);
    expect(
      Object.values(estimatedSeconds(second)).reduce((a, b) => a + b, 0),
    ).toBe(240 * 9);
  });
  it('preserves planned goalkeeper swaps when rebuilding edited substitution rows', () => {
    const from = ['a', 'b', 'c'];
    const planned = ['b', 'x', 'c'];
    expect(substitutionLineup(from, planned, [{ off: 'a', on: 'x' }])).toEqual([
      'b',
      'x',
      'c',
    ]);
    expect(substitutionLineup(from, planned, [{ off: 'a', on: 'a' }])).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(substitutionLineup(from, planned, [{ off: 'b', on: 'x' }])).toEqual([
      'a',
      'x',
      'c',
    ]);
  });
  it('allows editing the next visible substitution past unchanged blocks without skipping schedule accounting', () => {
    const original = run();
    original.blocks[1].lineup = [...original.lineup];
    expect(nextBlockIndex(original)).toBe(1);
    expect(nextSubstitutionIndex(original)).toBe(2);
    const next = editNextBlock(original, 2, original.blocks[2].lineup, [
      'player-10',
      ...original.blocks[2].lineup.slice(1),
    ]);
    expect(next.blocks[1]).toEqual(original.blocks[1]);
    expect(next.lineup).toEqual(original.lineup);
    expect(next.events).toEqual(original.events);
    expect(next.blocks[3].lineup[0]).toBe('player-10');
  });
  it('estimates final minutes from actual play and an overdue pending lineup', () => {
    const due = advance(toggleClock(run(), 1000), 951000);
    const totals = estimatedSeconds(due);
    expect(totals['player-1']).toBe(2150);
    expect(totals['player-9']).toBe(1450);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(
      2400 * 9,
    );
  });
  it('uses the corrected live lineup until the next future block in estimates', () => {
    const due = advance(toggleClock(run(), 1000), 951000);
    const lineup = [...due.blocks[1].lineup];
    lineup[2] = 'player-10';
    const corrected = acknowledge(due, lineup);
    const totals = estimatedSeconds(corrected);
    expect(totals['player-10']).toBe(550);
    expect(totals['player-2']).toBe(1850);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(
      2400 * 9,
    );
  });
  it('includes the second-half lineup at halftime and equals actual totals at full time', () => {
    const original = run();
    original.clock = { phase: 'halftime', elapsed: 1200, anchor: null };
    const totals = estimatedSeconds(original);
    expect(totals['player-1']).toBe(2400);
    expect(totals['player-0']).toBe(1200);
    expect(totals['player-9']).toBe(1200);
    original.clock = { phase: 'fulltime', elapsed: 2400, anchor: null };
    expect(estimatedSeconds(original)).toEqual(actualSeconds(original));
  });
  it('keeps the current goalkeeper when cancelling a pending goalkeeper change', () => {
    const original = run();
    original.interval = 300;
    original.blocks = boundaries(2400, 300).map((at) => ({
      at,
      lineup: [...original.lineup],
    }));
    const planned = editNextBlock(original, 1, original.blocks[1].lineup, [
      'player-10',
      ...original.lineup.slice(1),
    ]);
    const due = advance(toggleClock(planned, 1000), 351000);
    const kept = acknowledge(due, due.lineup);
    expect(kept.blocks[2].lineup[0]).toBe('player-0');
    expect(kept.blocks[3].lineup[0]).toBe('player-0');
    expect(kept.blocks[4].lineup).toEqual(original.blocks[4].lineup);
  });
  it('cancels a pending substitution without changing the actual events', () => {
    const due = advance(toggleClock(run(), 1000), 951000);
    const next = editNextBlock(due, 1, due.blocks[1].lineup, due.lineup);
    expect(next.lineup).toEqual(due.lineup);
    expect(next.events).toEqual(due.events);
    expect(next.pendingBlock).toBeNull();
    expect(next.notice).toBeNull();
    expect(next.appliedBlock).toBe(1);
  });
  it('propagates a next-half goalkeeper edit without changing live history', () => {
    const original = run();
    original.clock = { phase: 'halftime', elapsed: 1200, anchor: null };
    original.appliedBlock = 1;
    const target = ['player-10', ...original.blocks[2].lineup.slice(1)];
    const next = editNextBlock(original, 2, original.blocks[2].lineup, target);
    expect(next.blocks[3].lineup).toEqual([
      'player-10',
      'player-9',
      'player-1',
      ...original.blocks[3].lineup.slice(3),
    ]);
    expect(next.lineup).toEqual(original.lineup);
    expect(next.events).toEqual(original.events);
    expect(next.blocks.slice(0, 2)).toEqual(original.blocks.slice(0, 2));
  });
  it('rejects edits of a stale next block or changed draft base', () => {
    const original = run();
    const base = original.blocks[1].lineup;
    const applied = acknowledge(advance(toggleClock(original, 1000), 951000));
    expect(() => editNextBlock(applied, 1, base, base)).toThrow(
      'next block changed',
    );
    const edited = editNextBlock(original, 1, base, original.lineup);
    expect(() => editNextBlock(edited, 1, base, base)).toThrow(
      'next block changed',
    );
  });
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
  it('preserves manual schedules and edited boundaries in saves and backups while accepting old plans', () => {
    const old = populated();
    expect(parseState(old).teams[0].templates[0].strategy).toBeUndefined();
    const original: Template = {
      ...template(),
      strategy: 'manual',
      customTimes: [0, 300, 1200, 1620],
      blocks: generateBlocks(
        players,
        '9:3-2-3',
        2400,
        900,
        undefined,
        'manual',
        [0, 300, 1200, 1620],
      ),
    };
    const manual = editBlock(
      original,
      2,
      original.blocks[2].lineup,
      players,
      true,
    );
    const state = populated();
    state.teams[0].templates = [manual];
    expect(
      importBackup(exportBackup(state), null).teams[0].templates[0],
    ).toEqual(manual);
    const active = createRun(
      { id: 'team', name: 'Team' },
      manual,
      players,
      '2026-11-13',
      '',
    );
    expect(parseState({ ...state, active }).active).toMatchObject({
      strategy: 'manual',
      customTimes: manual.customTimes,
      blocks: manual.blocks,
    });
    const invalid = structuredClone(state);
    invalid.teams[0].templates[0].blocks[1].at = 600;
    expect(() => parseState(invalid)).toThrow('chosen interval');
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
