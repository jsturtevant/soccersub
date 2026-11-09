import { formation, type Player } from './domain';

type Props = {
  formationId: string;
  lineup: string[];
  players: Player[];
  onChange?: (slot: number, player: string) => void;
};

export function Field({ formationId, lineup, players, onChange }: Props) {
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
    <div className="pitch" aria-label="Soccer field">
      <div className="pitch-center" aria-hidden="true" />
      <div className="pitch-box top" aria-hidden="true" />
      <div className="pitch-box bottom" aria-hidden="true" />
      {fieldRows.map((slots, row) => (
        <div className="pitch-row" key={row}>
          {slots.map((slot) => {
            const player = players.find((item) => item.id === lineup[slot]);
            return (
              <div className="pitch-player" key={slot}>
                <span className="shirt" aria-hidden="true">
                  {player?.number || (slot === 0 ? 'G' : '•')}
                </span>
                {onChange ? (
                  <select
                    aria-label={`Player in field slot ${slot + 1}${slot === 0 ? ' (goalkeeper)' : ''}`}
                    value={lineup[slot] ?? ''}
                    onChange={(event) => onChange(slot, event.target.value)}
                  >
                    {players.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="player-name">
                    {player?.name ?? 'Unassigned'}
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
