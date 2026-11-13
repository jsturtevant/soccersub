import type { Player } from './domain';

export const rotationStrategyIds = [
  'fair',
  'small-changes',
  'longer-shifts',
  'manual',
] as const;
export type RotationStrategy = (typeof rotationStrategyIds)[number];

export const rotationStrategies: Record<
  RotationStrategy,
  { name: string; description: string }
> = {
  fair: {
    name: 'Fair participation',
    description:
      'Prioritize a turn in each half and no consecutive bench blocks. This can require one-block shifts or more than three substitutions.',
  },
  'small-changes': {
    name: 'Small changes',
    description:
      'Bring on at most three players per block and balance playing time. Players may sit for consecutive blocks or miss a short half.',
  },
  'longer-shifts': {
    name: 'Longer shifts',
    description:
      'Keep players on for at least two blocks and bring on at most three players per block. The halftime goalkeeper change is an exception. Bench waits may be longer.',
  },
  manual: {
    name: 'Advanced manual plan',
    description:
      'Choose substitution times. Every block starts with the same players, with no automatic substitutions or goalkeeper swap. Edit the blocks you want to change.',
  },
};

export function selectRotationPlayers({
  players,
  keeper,
  previous,
  minutes,
  stints,
  benchBlocks,
  playedThisHalf,
  size,
  strategy,
}: {
  players: Player[];
  keeper: string;
  previous?: string[];
  minutes: Record<string, number>;
  stints: Record<string, number>;
  benchBlocks: Record<string, number>;
  playedThisHalf: Set<string>;
  size: number;
  strategy: Exclude<RotationStrategy, 'manual'>;
}): Player[] {
  let candidates = players
    .filter((player) => player.id !== keeper)
    .sort((a, b) => {
      if (strategy === 'fair') {
        const priority =
          Number(playedThisHalf.has(a.id)) - Number(playedThisHalf.has(b.id)) ||
          benchBlocks[b.id] - benchBlocks[a.id];
        if (priority) return priority;
      }
      if (strategy !== 'small-changes') {
        const priority =
          Number(previous?.includes(b.id) && stints[b.id] < 2) -
          Number(previous?.includes(a.id) && stints[a.id] < 2);
        if (priority) return priority;
      }
      return (
        minutes[a.id] - minutes[b.id] ||
        Number(previous?.includes(b.id)) - Number(previous?.includes(a.id)) ||
        a.id.localeCompare(b.id)
      );
    })
    .slice(0, size - 1);
  if (previous && strategy !== 'fair') {
    const limit = 3 - Number(!previous.includes(keeper));
    const skipped = new Set(
      candidates
        .filter((player) => !previous.includes(player.id))
        .slice(limit)
        .map((player) => player.id),
    );
    candidates = candidates.filter((player) => !skipped.has(player.id));
    const retained = players
      .filter(
        (player) =>
          previous.includes(player.id) &&
          player.id !== keeper &&
          !candidates.some((candidate) => candidate.id === player.id),
      )
      .sort(
        (a, b) => minutes[a.id] - minutes[b.id] || a.id.localeCompare(b.id),
      );
    candidates.push(...retained.slice(0, size - 1 - candidates.length));
  }
  return candidates;
}
