import {
  formation,
  formatTime,
  type PlanningProgress,
  type Player,
} from './domain';

type Props = {
  formationId: string;
  lineup: string[];
  players: Player[];
  nextLineup?: string[];
  recentlyOn?: string[];
  progress?: PlanningProgress;
  label?: string;
  onChange?: (slot: number, player: string) => void;
};

export function PlayerTime({
  player,
  progress,
}: {
  player: string;
  progress: PlanningProgress;
}) {
  const benched = progress.benched[player];
  const warning = `On bench for ${formatTime(benched)}`;
  return (
    <span className="player-time">
      Played {formatTime(progress.played[player])}
      {benched > 15 * 60 && (
        <span
          className="bench-alert"
          role="img"
          aria-label={warning}
          title={warning}
        />
      )}
    </span>
  );
}

export function Field({
  formationId,
  lineup,
  players,
  nextLineup,
  recentlyOn = [],
  progress,
  label = 'Soccer field',
  onChange,
}: Props) {
  const { rows } = formation(formationId);
  let index = 1;
  const fieldRows = rows
    .map((count) => {
      const slots = Array.from({ length: count }, () => index++);
      return slots;
    })
    .reverse();
  fieldRows.push([0]);
  return (
    <div className="pitch" role="group" aria-label={label}>
      <div className="pitch-center" aria-hidden="true" />
      <div className="pitch-box top" aria-hidden="true" />
      <div className="pitch-box bottom" aria-hidden="true" />
      {fieldRows.map((slots, row) => (
        <div className="pitch-row" key={row}>
          {slots.map((slot) => {
            const player = players.find((item) => item.id === lineup[slot]);
            const incomingId = nextLineup?.[slot];
            const incoming =
              incomingId !== lineup[slot]
                ? players.find((item) => item.id === incomingId)
                : undefined;
            const justOn = recentlyOn.includes(lineup[slot]);
            return (
              <div className="pitch-player" key={slot}>
                <span className="shirt" aria-hidden="true">
                  {player?.number || (slot === 0 ? 'G' : '•')}
                </span>
                <span
                  className={`player-name${onChange ? ' editable-name' : ''}${justOn ? ' recently-on' : ''}`}
                >
                  {onChange ? (
                    <select
                      aria-label={`Player in field slot ${slot + 1}${slot === 0 ? ' (goalkeeper)' : ''}`}
                      value={lineup[slot] ?? ''}
                      onChange={(event) => onChange(slot, event.target.value)}
                    >
                      {players
                        .filter(
                          (item) =>
                            item.id === lineup[slot] ||
                            !lineup.includes(item.id),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span>{player?.name ?? 'Unassigned'}</span>
                  )}
                  {justOn && <span className="recent-label">Just on</span>}
                </span>
                {progress && player && (
                  <PlayerTime player={player.id} progress={progress} />
                )}
                {incoming && (
                  <span className="incoming-preview">
                    <span className="incoming-player">
                      <span className="incoming-label">Next</span>{' '}
                      {incoming.name}
                    </span>
                    {progress && (
                      <PlayerTime player={incoming.id} progress={progress} />
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function swapPlayer(
  lineup: string[],
  slot: number,
  player: string,
): string[] {
  const next = [...lineup];
  const existing = next.indexOf(player);
  if (existing >= 0) next[existing] = next[slot];
  next[slot] = player;
  return next;
}
