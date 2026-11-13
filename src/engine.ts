import {
  uid,
  editBlock,
  keepGoalkeeper,
  validateLineup,
  validatePlan,
  type Player,
  type Run,
  type Template,
} from './domain';

export function createRun(
  team: { id: string; name: string },
  template: Template,
  players: Player[],
  date: string,
  opponent: string,
): Run {
  validatePlan(template, players);
  return {
    ...structuredClone(template),
    id: uid(),
    teamId: team.id,
    teamName: team.name,
    templateId: template.id,
    templateName: template.name,
    players: structuredClone(players),
    date,
    opponent,
    clock: { phase: 'first', elapsed: 0, anchor: null },
    lineup: [...template.blocks[0].lineup],
    events: [
      { at: 0, lineup: [...template.blocks[0].lineup], source: 'planned' },
    ],
    appliedBlock: 0,
    pendingBlock: null,
    notice: null,
  };
}

export function changes(from: string[], to: string[]) {
  return {
    off: from.filter((id) => !to.includes(id)),
    on: to.filter((id) => !from.includes(id)),
  };
}

export function nextBlockIndex(run: Run): number {
  if (run.clock.phase === 'fulltime') return -1;
  if (run.pendingBlock !== null) return run.pendingBlock;
  return run.blocks.findIndex((block) =>
    run.clock.phase === 'halftime'
      ? block.at === run.duration / 2
      : block.at > run.clock.elapsed,
  );
}

export function nextSubstitutionIndex(run: Run): number {
  const first = nextBlockIndex(run);
  if (first < 0 || run.pendingBlock !== null) return first;
  for (let index = first; index < run.blocks.length; index++) {
    const block = run.blocks[index];
    if (
      block.at === run.duration / 2 ||
      changes(run.lineup, block.lineup).on.length > 0
    )
      return index;
  }
  return first;
}

export function recentArrivals(run: Run): string[] {
  for (let index = run.events.length - 1; index > 0; index--) {
    const incoming = changes(
      run.events[index - 1].lineup,
      run.events[index].lineup,
    ).on;
    if (incoming.length > 0)
      return incoming.filter((id) => run.lineup.includes(id));
  }
  return [];
}

export function editNextBlock(
  run: Run,
  index: number,
  base: string[],
  lineup: string[],
): Run {
  if (
    (index !== nextBlockIndex(run) && index !== nextSubstitutionIndex(run)) ||
    index <= run.appliedBlock ||
    base.some((id, slot) => id !== run.blocks[index]?.lineup[slot]) ||
    base.length !== run.blocks[index]?.lineup.length
  )
    throw new Error(
      'The next block changed. Review the next planned block again.',
    );
  const next = editBlock(run, index, lineup, run.players);
  if (next.pendingBlock === index) {
    if (lineup.every((id, slot) => id === next.lineup[slot])) {
      next.appliedBlock = index;
      next.pendingBlock = null;
      next.notice = null;
    } else {
      next.notice = { from: [...next.lineup], to: [...lineup], missed: 0 };
    }
  }
  return next;
}

export function substitutions(from: string[], to: string[]) {
  return changes(from, to).off.map((off) => {
    let on = to[from.indexOf(off)];
    // Follow position moves to the bench player replacing each outgoing player.
    while (from.includes(on)) on = to[from.indexOf(on)];
    return { off, on };
  });
}

export function substitutionLineup(
  from: string[],
  planned: string[],
  pairs: ReturnType<typeof substitutions>,
): string[] {
  if (new Set(pairs.map((pair) => pair.off)).size !== pairs.length)
    throw new Error(
      'Each outgoing player can appear in only one substitution.',
    );
  const lineup = [...from];
  const keeperSlot = from.indexOf(planned[0]);
  // Preserve the planned goalkeeper swap, but anchor retained outfield players.
  if (
    keeperSlot > 0 &&
    !pairs.some((pair) => pair.off === planned[0] && pair.off !== pair.on)
  )
    [lineup[0], lineup[keeperSlot]] = [lineup[keeperSlot], lineup[0]];
  for (const { off, on } of pairs) {
    if (!from.includes(off) || (on !== off && from.includes(on)))
      throw new Error(
        'Choose a field player and a bench player, or keep the outgoing player on.',
      );
    if (off === on) continue;
    const slot = lineup.indexOf(off);
    if (slot < 0 || lineup.includes(on))
      throw new Error('Each substitution must use different players.');
    lineup[slot] = on;
  }
  return lineup;
}

function record(
  run: Run,
  at: number,
  lineup: string[],
  source: Run['events'][number]['source'],
) {
  const last = run.events.at(-1);
  if (last && last.at > at)
    throw new Error('A lineup change cannot precede the recorded game time.');
  const event = { at, lineup: [...lineup], source };
  if (last?.at === at) run.events[run.events.length - 1] = event;
  else run.events.push(event);
  run.lineup = [...lineup];
}

export function advance(run: Run, now: number, catchUp = false): Run {
  const next = structuredClone(run);
  const limit =
    next.clock.phase === 'first' ? next.duration / 2 : next.duration;
  if (next.clock.anchor !== null) {
    next.clock.elapsed = Math.min(
      limit,
      next.clock.elapsed + Math.max(0, now - next.clock.anchor) / 1000,
    );
    next.clock.anchor = now;
    if (next.clock.elapsed >= limit) {
      next.clock.phase = limit === next.duration ? 'fulltime' : 'halftime';
      next.clock.anchor = null;
    }
  }
  const max =
    next.clock.phase === 'halftime'
      ? next.duration / 2 - 0.001
      : next.clock.elapsed;
  let due = next.appliedBlock;
  while (next.blocks[due + 1]?.at <= max) due++;
  if (due <= next.appliedBlock) return next;
  const missed = due - next.appliedBlock;
  const from = [...next.lineup];
  const to = next.blocks[due].lineup;
  const delta = changes(from, to);
  const alreadyPending = next.pendingBlock === due && missed === 1;
  if ((catchUp && !alreadyPending) || missed > 1) {
    for (let index = next.appliedBlock + 1; index <= due; index++) {
      // A coach correction may already have been recorded after a missed boundary.
      record(
        next,
        Math.max(next.events.at(-1)?.at ?? 0, next.blocks[index].at),
        next.blocks[index].lineup,
        'assumed',
      );
    }
    next.appliedBlock = due;
    next.pendingBlock = null;
    next.notice = { from, to: [...to], missed };
  } else if (delta.off.length === 0 && delta.on.length === 0) {
    record(next, next.clock.elapsed, to, 'planned');
    next.appliedBlock = due;
    next.pendingBlock = null;
  } else {
    next.pendingBlock = due;
    next.notice = { from, to: [...to], missed: 0 };
  }
  return next;
}

export function acknowledge(run: Run, lineup?: string[]): Run {
  let next = structuredClone(run);
  const target =
    lineup ??
    (next.pendingBlock !== null
      ? next.blocks[next.pendingBlock].lineup
      : next.lineup);
  validateLineup(target, next.players, next.formationId);
  const plannedKeeper =
    next.pendingBlock !== null
      ? next.blocks[next.pendingBlock].lineup[0]
      : next.lineup[0];
  if (
    next.strategy !== 'manual' &&
    lineup &&
    (target[0] !== next.lineup[0] || target[0] !== plannedKeeper)
  )
    next = keepGoalkeeper(
      next,
      target[0],
      next.clock.elapsed,
      next.clock.phase === 'first' || next.clock.phase === 'halftime'
        ? next.duration / 2
        : next.duration,
    );
  record(next, next.clock.elapsed, target, lineup ? 'coach' : 'planned');
  if (next.pendingBlock !== null) next.appliedBlock = next.pendingBlock;
  next.pendingBlock = null;
  next.notice = null;
  return next;
}

export function startSecondHalf(run: Run, now: number, lineup?: string[]): Run {
  if (run.clock.phase !== 'halftime')
    throw new Error('The second half can only start at halftime.');
  let next = structuredClone(run);
  const index = next.blocks.findIndex(
    (block) => block.at === next.duration / 2,
  );
  const target = lineup ?? next.blocks[index].lineup;
  validateLineup(target, next.players, next.formationId);
  if (lineup) next = editBlock(next, index, target, next.players);
  record(next, next.duration / 2, target, lineup ? 'coach' : 'planned');
  next.appliedBlock = index;
  next.pendingBlock = null;
  next.notice = null;
  next.clock = { phase: 'second', elapsed: next.duration / 2, anchor: now };
  return next;
}

export function toggleClock(run: Run, now: number): Run {
  const next = advance(run, now);
  if (next.clock.phase === 'halftime' || next.clock.phase === 'fulltime')
    return next;
  next.clock.anchor = next.clock.anchor === null ? now : null;
  return next;
}

export function actualSeconds(run: Run): Record<string, number> {
  const result = Object.fromEntries(
    run.players.map((player) => [player.id, 0]),
  );
  run.events.forEach((event, index) => {
    const length = Math.max(
      0,
      (run.events[index + 1]?.at ?? run.clock.elapsed) - event.at,
    );
    event.lineup.forEach((id) => {
      result[id] += length;
    });
  });
  return result;
}

export function estimatedSeconds(run: Run): Record<string, number> {
  const result = actualSeconds(run);
  let at = run.clock.elapsed;
  let lineup = run.lineup;
  const add = (length: number) => {
    for (const id of lineup) result[id] += length;
  };
  const first = nextBlockIndex(run);
  if (first >= 0) {
    for (let index = first; index < run.blocks.length; index++) {
      const block = run.blocks[index];
      const nextAt = Math.max(at, block.at);
      add(nextAt - at);
      at = nextAt;
      lineup = block.lineup;
    }
  }
  add(run.duration - at);
  return result;
}
