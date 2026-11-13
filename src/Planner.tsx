import { useState } from 'react';
import {
  formation,
  editBlock,
  formations,
  formatTime,
  generateBlocks,
  plannedSeconds,
  rotationWarnings,
  rotationStrategySchema,
  uid,
  validatePlan,
  type Player,
  type Template,
  type Team,
} from './domain';
import { Field, swapPlayer } from './Field';
import { changes } from './engine';
import {
  rotationStrategies,
  rotationStrategyIds,
  type RotationStrategy,
} from './rotations';

function StrategySelect({
  value,
  onChange,
}: {
  value: RotationStrategy;
  onChange: (value: RotationStrategy) => void;
}) {
  return (
    <div className="full">
      <label>
        Rotation strategy
        <select
          value={value}
          aria-describedby="rotation-strategy-info"
          onChange={(event) =>
            onChange(rotationStrategySchema.parse(event.target.value))
          }
        >
          {rotationStrategyIds.map((id) => (
            <option key={id} value={id}>
              {rotationStrategies[id].name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint" id="rotation-strategy-info">
        {rotationStrategies[value].description}
      </p>
    </div>
  );
}

export function Minutes({
  players,
  totals,
}: {
  players: Player[];
  totals: Record<string, number>;
}) {
  return (
    <div className="minutes">
      {players.map((player) => (
        <div key={player.id}>
          <span>{player.name}</span>
          <strong>{formatTime(totals[player.id] ?? 0)}</strong>
        </div>
      ))}
    </div>
  );
}

export function LineupEditor({
  plan,
  players,
  onChange,
}: {
  plan: Template;
  players: Player[];
  onChange: (plan: Template) => void;
}) {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, plan.blocks.length - 1);
  const block = plan.blocks[index];
  const half = plan.duration / 2;
  const halfKeepers = [
    plan.blocks[0].lineup[0],
    plan.blocks.find((item) => item.at === half)?.lineup[0],
  ];
  const noKeeperSwap = halfKeepers[0] === halfKeepers[1];
  const warnings = rotationWarnings(plan, players);
  return (
    <>
      <div className="section-heading">
        <h2>Lineup blocks</h2>
        <span className="badge">{formation(plan.formationId).layout}</span>
      </div>
      <p className="hint">
        Choose a block, then tap a player on the field to select a substitute
        from the bench. Players who stay on keep their positions. Goalkeepers
        may change at halftime. A goalkeeper edit lasts for the rest of that
        half.
      </p>
      <p className="hint">
        Green marks players who came on from the previous block. Yellow shows
        who comes on in the next block.
      </p>
      <p className="hint">
        {rotationStrategies[plan.strategy ?? 'fair'].description}
      </p>
      {warnings.length > 0 && (
        <div className="warning" role="status">
          <strong>Rotation goals need attention</strong>
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p>
            Review the lineups, use shorter blocks or reduce the squad if
            needed.
          </p>
        </div>
      )}
      <div className="block-tabs" role="group" aria-label="Lineup blocks">
        {plan.blocks.map((item, i) => (
          <button
            type="button"
            key={item.at}
            className={i === index ? 'selected' : ''}
            aria-pressed={i === index}
            onClick={() => setSelected(i)}
          >
            {item.at < half ? '1st' : '2nd'} · {formatTime(item.at % half)}
            {item.at === half && <span>Halftime</span>}
          </button>
        ))}
      </div>
      <Field
        formationId={plan.formationId}
        lineup={block.lineup}
        players={players}
        nextLineup={plan.blocks[index + 1]?.lineup}
        recentlyOn={
          index > 0
            ? changes(plan.blocks[index - 1].lineup, block.lineup).on
            : []
        }
        onChange={(slot, player) =>
          onChange(
            editBlock(
              plan,
              index,
              swapPlayer(block.lineup, slot, player),
              players,
            ),
          )
        }
      />
      <div className="bench">
        <span className="eyebrow">On the bench</span>
        <p>
          {players
            .filter((player) => !block.lineup.includes(player.id))
            .map((player) => player.name)
            .join(' · ') || 'Everyone is on the field'}
        </p>
      </div>
      {noKeeperSwap && (
        <p className="hint warning">
          The same goalkeeper starts both halves. Select another goalkeeper at
          halftime if needed.
        </p>
      )}
      <details className="card">
        <summary>Planned playing time</summary>
        <Minutes
          players={players}
          totals={plannedSeconds(plan.blocks, plan.duration, players)}
        />
      </details>
    </>
  );
}

export function Planner({
  team,
  initial,
  save,
  cancel,
  attempt,
}: {
  team: Team;
  initial?: Template;
  save: (template: Template) => void;
  cancel: () => void;
  attempt: (action: () => void) => void;
}) {
  const [name, setName] = useState(initial?.name ?? 'Saturday rotation');
  const [formationId, setFormation] = useState(
    initial?.formationId ?? '9:3-2-3',
  );
  const [duration, setDuration] = useState(
    initial ? String(initial.duration / 60) : '60',
  );
  const [interval, setInterval] = useState(
    initial ? String(initial.interval / 60) : '5',
  );
  const [draft, setDraft] = useState<Template | null>(initial ?? null);
  const [strategy, setStrategy] = useState<RotationStrategy>(
    initial?.strategy ?? 'fair',
  );
  const size = formation(formationId).size;
  const planName = name.trim();
  const generate = () =>
    attempt(() => {
      setDraft({
        id: initial?.id ?? uid(),
        name: planName || 'Saturday rotation',
        formationId,
        duration: Number(duration) * 60,
        interval: Number(interval) * 60,
        strategy,
        blocks: generateBlocks(
          team.players,
          formationId,
          Number(duration) * 60,
          Number(interval) * 60,
          undefined,
          strategy,
        ),
      });
    });
  const dirtyTiming =
    draft &&
    (draft.formationId !== formationId ||
      draft.duration !== Number(duration) * 60 ||
      draft.interval !== Number(interval) * 60 ||
      (draft.strategy ?? 'fair') !== strategy);
  return (
    <section>
      <p className="eyebrow">{team.name} / Plan template</p>
      <h1>{initial ? 'Edit your plan' : 'Build your game plan'}</h1>
      <p className="lead">Set the rhythm. Make it fair. Adjust it your way.</p>
      <div className="card form-grid">
        <label className="full">
          Plan name
          <input
            value={name}
            maxLength={80}
            required
            aria-invalid={!planName}
            aria-describedby={!planName ? 'plan-name-hint' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {!planName && (
          <p className="hint warning full" id="plan-name-hint" role="status">
            Enter a plan name before saving.
          </p>
        )}
        <label>
          Players per side
          <select
            value={size}
            onChange={(event) => {
              const next = formations.find(
                (item) => item.size === Number(event.target.value),
              );
              if (next) setFormation(next.id);
            }}
          >
            {[7, 9, 11].map((n) => (
              <option key={n} value={n}>
                {n}v{n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Formation
          <select
            value={formationId}
            onChange={(event) => setFormation(event.target.value)}
          >
            {formations
              .filter((item) => item.size === size)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.layout}
                </option>
              ))}
          </select>
        </label>
        <label>
          Total game minutes
          <input
            type="number"
            min={2}
            max={240}
            step={1}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <label>
          Rotation every (minutes)
          <input
            type="number"
            min={0.5}
            max={120}
            step={0.5}
            value={interval}
            onChange={(event) => setInterval(event.target.value)}
          />
        </label>
        <p className="hint full">
          Two equal halves. The clock stops at halftime. Goalkeeper changes are
          suggested for the second half.
        </p>
        <StrategySelect value={strategy} onChange={setStrategy} />
        <button className="secondary full" onClick={generate}>
          {draft ? 'Regenerate lineups' : 'Generate lineups'}
        </button>
      </div>
      {team.players.length < size && (
        <p className="warning">
          Add at least {size} players to this team's roster before generating a
          plan.
        </p>
      )}
      {dirtyTiming && (
        <p className="warning" role="status">
          Settings changed. Regenerate lineups before saving.
        </p>
      )}
      {draft && (
        <LineupEditor plan={draft} players={team.players} onChange={setDraft} />
      )}
      <div className="action-bar">
        <button className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button
          disabled={!draft || !planName || !!dirtyTiming}
          onClick={() =>
            attempt(() => {
              if (!draft) throw new Error('Generate your lineups first.');
              const next = { ...draft, name: planName };
              validatePlan(next, team.players);
              save(next);
            })
          }
        >
          Save plan
        </button>
      </div>
    </section>
  );
}

export function GameSetup({
  team,
  template,
  start,
  cancel,
  attempt,
}: {
  team: Team;
  template: Template;
  start: (
    plan: Template,
    players: Player[],
    date: string,
    opponent: string,
  ) => void;
  cancel: () => void;
  attempt: (action: () => void) => void;
}) {
  const [squad, setSquad] = useState(team.players.map((player) => player.id));
  const [duration, setDuration] = useState(String(template.duration / 60));
  const [interval, setInterval] = useState(String(template.interval / 60));
  const [strategy, setStrategy] = useState<RotationStrategy>(
    template.strategy ?? 'fair',
  );
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [opponent, setOpponent] = useState('');
  const [plan, setPlan] = useState<Template>(structuredClone(template));
  const [prepared, setPrepared] = useState(true);
  const players = team.players.filter((player) => squad.includes(player.id));
  const canReuse = plan.blocks.every((block) =>
    block.lineup.every((id) => squad.includes(id)),
  );
  const changeSquad = (id: string, checked: boolean) => {
    setSquad((previous) =>
      checked ? [...previous, id] : previous.filter((item) => item !== id),
    );
    setPrepared(false);
  };
  return (
    <section>
      <p className="eyebrow">
        {team.name} / {template.name}
      </p>
      <h1>Ready for kickoff?</h1>
      <p className="lead">
        Choose today's squad. Your template stays unchanged.
      </p>
      <div className="card form-grid">
        <label>
          Game date
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          Opponent (optional)
          <input
            maxLength={80}
            value={opponent}
            onChange={(event) => setOpponent(event.target.value)}
          />
        </label>
        <label>
          Total game minutes
          <input
            type="number"
            min={2}
            max={240}
            value={duration}
            onChange={(event) => {
              setDuration(event.target.value);
              setPrepared(false);
            }}
          />
        </label>
        <label>
          Rotation every (minutes)
          <input
            type="number"
            min={0.5}
            max={120}
            step={0.5}
            value={interval}
            onChange={(event) => {
              setInterval(event.target.value);
              setPrepared(false);
            }}
          />
        </label>
        <StrategySelect
          value={strategy}
          onChange={(value) => {
            setStrategy(value);
            setPrepared(false);
          }}
        />
      </div>
      <h2>
        Available squad <span className="badge">{players.length} players</span>
      </h2>
      <div className="squad-grid">
        {team.players.map((player) => (
          <label className="squad-option" key={player.id}>
            <input
              type="checkbox"
              checked={squad.includes(player.id)}
              onChange={(event) => changeSquad(player.id, event.target.checked)}
            />
            <span>
              {player.name}
              <small>
                {player.number ? `#${player.number}` : 'No shirt number'}
              </small>
            </span>
          </label>
        ))}
      </div>
      <div className="row wrap">
        <button
          className="secondary"
          onClick={() =>
            attempt(() => {
              const total = Number(duration) * 60;
              const step = Number(interval) * 60;
              const start = plan.blocks[0].lineup.every((id) =>
                squad.includes(id),
              )
                ? plan.blocks[0].lineup
                : undefined;
              setPlan({
                ...template,
                duration: total,
                interval: step,
                strategy,
                blocks: generateBlocks(
                  players,
                  template.formationId,
                  total,
                  step,
                  start,
                  strategy,
                ),
              });
              setPrepared(true);
            })
          }
        >
          Generate today's lineups
        </button>
        {!prepared &&
          canReuse &&
          Number(duration) * 60 === template.duration &&
          Number(interval) * 60 === template.interval &&
          strategy === (template.strategy ?? 'fair') && (
            <button
              className="text-button"
              onClick={() => {
                setPlan(structuredClone(template));
                setPrepared(true);
              }}
            >
              Keep template lineups
            </button>
          )}
      </div>
      {!prepared && (
        <p className="warning">
          Review or regenerate lineups after changing the squad or timing.
        </p>
      )}
      {prepared && (
        <LineupEditor plan={plan} players={players} onChange={setPlan} />
      )}
      <div className="action-bar">
        <button className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button
          disabled={!prepared || !date}
          onClick={() =>
            attempt(() => {
              validatePlan(plan, players);
              start(plan, players, date, opponent);
            })
          }
        >
          Start game
        </button>
      </div>
    </section>
  );
}
