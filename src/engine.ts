import {
  uid,
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
  const next = structuredClone(run);
  const target =
    lineup ??
    (next.pendingBlock !== null
      ? next.blocks[next.pendingBlock].lineup
      : next.lineup);
  validateLineup(target, next.players, next.formationId);
  record(next, next.clock.elapsed, target, lineup ? 'coach' : 'planned');
  if (next.pendingBlock !== null) next.appliedBlock = next.pendingBlock;
  next.pendingBlock = null;
  next.notice = null;
  return next;
}

export function startSecondHalf(run: Run, now: number, lineup?: string[]): Run {
  if (run.clock.phase !== 'halftime')
    throw new Error('The second half can only start at halftime.');
  const next = structuredClone(run);
  const index = next.blocks.findIndex(
    (block) => block.at === next.duration / 2,
  );
  const target = lineup ?? next.blocks[index].lineup;
  validateLineup(target, next.players, next.formationId);
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
