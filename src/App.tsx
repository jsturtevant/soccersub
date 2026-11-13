import { useEffect, useState, type FormEvent } from 'react';
import {
  emptyState,
  formation,
  playerSchema,
  roles,
  uid,
  type AppState,
  type Match,
  type Player,
  type Team,
  type Template,
} from './domain';
import {
  acknowledge,
  actualSeconds,
  advance,
  createRun,
  editNextBlock,
  startSecondHalf,
  toggleClock,
} from './engine';
import { exportBackup, importBackup, STORAGE_KEY } from './storage';
import { useStore } from './useStore';
import { Game, enableSound, ResultForm, useGameAlerts } from './Game';
import { GameSetup, Minutes, Planner } from './Planner';
import { useInstallPrompt } from './Pwa';

type View =
  'teams' | 'team' | 'plan' | 'setup' | 'game' | 'history' | 'settings';

function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function PlayerForm({
  initial,
  submit,
  cancel,
}: {
  initial?: Player;
  submit: (player: Player) => void;
  cancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [preferred, setPreferred] = useState<Player['roles']>(
    initial?.roles ?? [],
  );
  return (
    <form
      className="card form-grid"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit({
          id: initial?.id ?? uid(),
          name: name.trim(),
          number,
          roles: preferred,
        });
      }}
    >
      <label>
        Player name
        <input
          autoFocus
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Shirt number (optional)
        <input
          maxLength={6}
          inputMode="numeric"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
      </label>
      <fieldset className="full">
        <legend>Preferred roles (optional)</legend>
        <div className="role-options">
          {roles.map((role) => (
            <label key={role}>
              <input
                type="checkbox"
                checked={preferred.includes(role)}
                onChange={(event) =>
                  setPreferred(
                    event.target.checked
                      ? [...preferred, role]
                      : preferred.filter((item) => item !== role),
                  )
                }
              />
              {role}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row full">
        <button type="submit">{initial ? 'Save player' : 'Add player'}</button>
        <button type="button" className="text-button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TeamPage({
  team,
  update,
  openPlan,
  setup,
  back,
  attempt,
}: {
  team: Team;
  update: (team: Team) => void;
  openPlan: (template?: Template) => void;
  setup: (template: Template) => void;
  back: () => void;
  attempt: (action: () => void) => void;
}) {
  const [editing, setEditing] = useState<Player | 'new' | null>(null);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(team.name);
  return (
    <section>
      <button className="back" onClick={back}>
        ← All teams
      </button>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your team</p>
          <h1>{team.name}</h1>
        </div>
        <button className="text-button" onClick={() => setRename(!rename)}>
          Rename
        </button>
      </div>
      {rename && (
        <form
          className="card row"
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => {
              update({ ...team, name: name.trim() });
              setRename(false);
            });
          }}
        >
          <label className="grow">
            Team name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button>Save</button>
        </form>
      )}
      {team.archived && (
        <div className="card warning-panel">
          <p>This team is archived.</p>
          <button
            className="secondary"
            onClick={() => attempt(() => update({ ...team, archived: false }))}
          >
            Restore team
          </button>
        </div>
      )}
      <div className="section-heading">
        <h2>
          Game plans <span className="badge">{team.templates.length}</span>
        </h2>
        <button disabled={team.archived} onClick={() => openPlan()}>
          New plan
        </button>
      </div>
      {!team.templates.length && (
        <div className="empty-card">
          <h3>A good game starts with a plan.</h3>
          <p>Add your roster below, then create a rotation for the team.</p>
        </div>
      )}
      <div className="list">
        {team.templates.map((template) => (
          <article className="card plan-card" key={template.id}>
            <div>
              <h3>{template.name}</h3>
              <p>
                {formation(template.formationId).size}v
                {formation(template.formationId).size} ·{' '}
                {formation(template.formationId).layout} ·{' '}
                {template.duration / 60} min
              </p>
              <small>
                {template.customTimes
                  ? 'Custom substitution times'
                  : `Rotate every ${template.interval / 60} min`}{' '}
                · {template.blocks.length} blocks
              </small>
            </div>
            <div className="row wrap">
              <button disabled={team.archived} onClick={() => setup(template)}>
                Use for game
              </button>
              <button className="secondary" onClick={() => openPlan(template)}>
                Edit
              </button>
              <button
                className="text-button danger"
                onClick={() =>
                  attempt(() => {
                    if (
                      confirm(
                        `Delete "${template.name}"? Completed games will be kept.`,
                      )
                    ) {
                      update({
                        ...team,
                        templates: team.templates.filter(
                          (item) => item.id !== template.id,
                        ),
                      });
                    }
                  })
                }
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          Roster <span className="badge">{team.players.length}</span>
        </h2>
        <button className="secondary" onClick={() => setEditing('new')}>
          Add player
        </button>
      </div>
      {editing && (
        <PlayerForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          cancel={() => setEditing(null)}
          submit={(player) =>
            attempt(() => {
              playerSchema.parse(player);
              const players = team.players.some((item) => item.id === player.id)
                ? team.players.map((item) =>
                    item.id === player.id ? player : item,
                  )
                : [...team.players, player];
              update({ ...team, players });
              setEditing(null);
            })
          }
        />
      )}
      {!team.players.length && (
        <p className="hint">
          Start with player names. Shirt numbers and role preferences are
          optional.
        </p>
      )}
      <div className="roster-list">
        {team.players.map((player) => (
          <div className="roster-player" key={player.id}>
            <span className="number">{player.number || '—'}</span>
            <div className="grow">
              <strong>{player.name}</strong>
              <small>{player.roles.join(' · ') || 'Any role'}</small>
            </div>
            <button className="text-button" onClick={() => setEditing(player)}>
              Edit<span className="sr-only"> {player.name}</span>
            </button>
            <button
              className="text-button danger"
              aria-label={`Remove ${player.name}`}
              onClick={() =>
                attempt(() => {
                  if (
                    team.templates.some((template) =>
                      template.blocks.some((block) =>
                        block.lineup.includes(player.id),
                      ),
                    )
                  )
                    throw new Error(
                      'This player is used in a plan. Change or delete those plans before removing the player.',
                    );
                  if (
                    confirm(
                      `Remove ${player.name} from this roster? Past games will be kept.`,
                    )
                  )
                    update({
                      ...team,
                      players: team.players.filter(
                        (item) => item.id !== player.id,
                      ),
                    });
                })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!team.archived && (
        <button
          className="text-button danger"
          onClick={() =>
            attempt(() => {
              if (
                confirm(`Archive ${team.name}? Plans and history will be kept.`)
              ) {
                update({ ...team, archived: true });
              }
            })
          }
        >
          Archive team
        </button>
      )}
    </section>
  );
}

function History({
  matches,
  update,
  remove,
  teams,
}: {
  matches: Match[];
  update: (match: Match) => void;
  remove: (id: string) => void;
  teams: Team[];
}) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section>
      <p className="eyebrow">Looking back</p>
      <h1>Match history</h1>
      <p className="lead">The results and rotations, all in one place.</p>
      <label className="filter">
        Team
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      {!matches.length && (
        <div className="empty-card">
          <h2>First game still to come.</h2>
          <p>Completed matches will appear here.</p>
        </div>
      )}
      {matches
        .filter((match) => !filter || match.run.teamId === filter)
        .slice()
        .reverse()
        .map((match) => (
          <article className="card history-card" key={match.run.id}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {match.run.date} · {match.run.teamName}
                </p>
                <h2>
                  {match.run.opponent
                    ? `vs ${match.run.opponent}`
                    : match.run.templateName}
                </h2>
              </div>
              <span className="score">
                {match.scoreFor ?? '–'} : {match.scoreAgainst ?? '–'}
              </span>
            </div>
            {match.notes && <p className="match-notes">{match.notes}</p>}
            <details>
              <summary>Playing time and lineup log</summary>
              <Minutes
                players={match.run.players}
                totals={actualSeconds(match.run)}
              />
              <ol className="event-log">
                {match.run.events.map((event, index) => (
                  <li key={index}>
                    <strong>
                      {Math.floor(event.at / 60)}:
                      {String(Math.floor(event.at % 60)).padStart(2, '0')}
                    </strong>{' '}
                    <span>
                      {event.lineup
                        .map(
                          (id) =>
                            match.run.players.find((player) => player.id === id)
                              ?.name,
                        )
                        .join(', ')}
                    </span>
                    <small>
                      {event.source === 'assumed'
                        ? 'Assumed scheduled change'
                        : event.source === 'coach'
                          ? 'Coach-confirmed lineup'
                          : 'Planned lineup'}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
            <div className="row">
              <button
                className="text-button"
                onClick={() =>
                  setEditing(editing === match.run.id ? null : match.run.id)
                }
              >
                Edit result
              </button>
              <button
                className="text-button danger"
                onClick={() => {
                  if (confirm('Delete this match record permanently?'))
                    remove(match.run.id);
                }}
              >
                Delete record
              </button>
            </div>
            {editing === match.run.id && (
              <ResultForm
                initial={match}
                submit={(scoreFor, scoreAgainst, notes) => {
                  update({ ...match, scoreFor, scoreAgainst, notes });
                  setEditing(null);
                }}
              />
            )}
          </article>
        ))}
    </section>
  );
}

function Settings({
  state,
  replace,
  removeTeam,
  attempt,
  install,
}: {
  state: AppState;
  replace: (state: AppState) => void;
  removeTeam: (id: string) => void;
  attempt: (action: () => void) => void;
  install: (() => void) | null;
}) {
  const [preview, setPreview] = useState<AppState | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <p className="eyebrow">Private by design</p>
      <h1>Your data</h1>
      <p className="lead">
        Everything stays in this browser. Keep a backup somewhere safe.
      </p>
      <div className="card">
        <h2>Backup & restore</h2>
        <p>
          Browser data can be cleared or lost. Export your teams, plans, and
          completed matches regularly. Backups do not include an active game.
        </p>
        <button
          className="secondary"
          onClick={() =>
            attempt(() =>
              download(
                exportBackup(state),
                `touchline-backup-${new Date().toISOString().slice(0, 10)}.json`,
              ),
            )
          }
        >
          Export backup
        </button>
        <label className="import-label">
          Import backup
          <input
            type="file"
            accept=".json,application/json"
            disabled={!!state.active || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setBusy(true);
              attempt(() => {
                if (file.size > 10_000_000)
                  throw new Error('This backup is too large (maximum 10 MB).');
              });
              if (file.size > 10_000_000) {
                setBusy(false);
                return;
              }
              file
                .text()
                .then((text) =>
                  attempt(() => setPreview(importBackup(text, state.active))),
                )
                .catch((error: unknown) =>
                  attempt(() => {
                    throw error;
                  }),
                )
                .finally(() => setBusy(false));
            }}
          />
        </label>
        {state.active && (
          <p className="warning">
            End or discard the active game before importing.
          </p>
        )}
        {preview && (
          <div className="warning-panel">
            <h3>Replace all local data?</h3>
            <p>
              This backup contains {preview.teams.length} teams,{' '}
              {preview.teams.reduce(
                (sum, team) => sum + team.templates.length,
                0,
              )}{' '}
              plans, and {preview.history.length} completed matches.
            </p>
            <p>
              Existing data will be replaced. Export it first if you want to
              keep it.
            </p>
            <div className="row">
              <button
                className="danger"
                onClick={() =>
                  attempt(() => {
                    if (state.active)
                      throw new Error('End or discard the active game first.');
                    replace(preview);
                    setPreview(null);
                  })
                }
              >
                Confirm replacement
              </button>
              <button className="secondary" onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Delete local data</h2>
        <p>
          Delete all teams, players, plans, match history, and the unfinished
          game from this browser. Export a backup first. The app remains
          installed.
        </p>
        <button
          className="danger secondary"
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                'Permanently delete all teams, players, plans, match history, and the unfinished game? Export a backup first.',
              )
            )
              attempt(() => {
                replace(emptyState());
                setPreview(null);
              });
          }}
        >
          Delete all data
        </button>
      </div>
      <div className="card">
        <h2>Install for the touchline</h2>
        {install && (
          <button className="secondary" onClick={install}>
            Install app
          </button>
        )}
        <p>
          On iPhone or iPad, open in Safari and choose Share → Add to Home
          Screen. On Android Chrome or desktop, use your browser's Install app
          option.
        </p>
        <p>
          Open the app once while online before using it offline. Keep it open
          for sound alerts.
        </p>
      </div>
      {state.teams.some((team) => team.archived) && (
        <div className="card">
          <h2>Archived teams</h2>
          {state.teams
            .filter((team) => team.archived)
            .map((team) => (
              <div className="row" key={team.id}>
                <strong className="grow">{team.name}</strong>
                <button
                  className="text-button danger"
                  onClick={() => removeTeam(team.id)}
                >
                  Delete permanently
                </button>
              </div>
            ))}
        </div>
      )}
      <p className="hint">
        No account. No analytics. No data sent to a server.
      </p>
    </section>
  );
}

export default function App() {
  const { state, current, commit, attempt, error, setError, blocked } =
    useStore();
  const [installPrompt, setInstallPrompt] = useInstallPrompt();
  const [view, setView] = useState<View>(state.active ? 'game' : 'teams');
  const [teamId, setTeamId] = useState('');
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [teamName, setTeamName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [recovered, setRecovered] = useState(!!state.active);
  const team = state.teams.find((item) => item.id === teamId);
  const template = team?.templates.find((item) => item.id === templateId);

  useGameAlerts(state.active, recovered, attempt);
  const liveAlertDue = state.active
    ? state.active.notice !== null ||
      state.active.pendingBlock !== null ||
      state.active.clock.phase === 'halftime' ||
      state.active.clock.phase === 'fulltime'
    : false;

  useEffect(() => {
    const updateClock = (catchUp = false) => {
      if (recovered || blocked || !current.current.active?.clock.anchor) return;
      attempt(() =>
        commit((previous) =>
          previous.active
            ? {
                ...previous,
                active: advance(previous.active, Date.now(), catchUp),
              }
            : previous,
        ),
      );
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) updateClock();
    }, 1000);
    const visible = () => {
      if (!document.hidden) updateClock(true);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [attempt, blocked, commit, current, recovered]);

  const navigate = (next: View) => {
    setView(next);
    setError('');
    window.scrollTo({ top: 0 });
  };
  const updateTeam = (next: Team) =>
    commit((previous) => ({
      ...previous,
      teams: previous.teams.map((item) => (item.id === next.id ? next : item)),
    }));
  const mutateRun = (
    action: (
      run: NonNullable<AppState['active']>,
    ) => NonNullable<AppState['active']>,
  ) => {
    let saved = false;
    attempt(() => {
      commit((previous) => {
        if (!previous.active) throw new Error('No active game was found.');
        return { ...previous, active: action(previous.active) };
      });
      saved = true;
    });
    return saved;
  };
  const discard = () => {
    if (confirm('Discard this unfinished game? It will not appear in history.'))
      attempt(() => {
        commit((previous) => ({ ...previous, active: null }));
        setRecovered(false);
        navigate('teams');
      });
  };

  return (
    <>
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('teams');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          touchline<span className="brand-dot">.</span>
        </a>
        <span className="local-badge">
          <span />
          Saved on this device
        </span>
      </header>
      <nav className="app-nav" aria-label="Main navigation">
        <button
          className={
            ['teams', 'team', 'plan', 'setup'].includes(view) ? 'active' : ''
          }
          onClick={() => navigate('teams')}
        >
          Teams & plans
        </button>
        {state.active && (
          <button
            className={view === 'game' ? 'active' : ''}
            onClick={() => navigate('game')}
          >
            Live game <span className="nav-dot" />
          </button>
        )}
        <button
          className={view === 'history' ? 'active' : ''}
          onClick={() => navigate('history')}
        >
          History
        </button>
        <button
          className={view === 'settings' ? 'active' : ''}
          onClick={() => navigate('settings')}
        >
          Your data
        </button>
      </nav>
      <main>
        {error && (
          <div className="error-banner" role="alert">
            <strong>
              {blocked
                ? 'Local data needs attention'
                : 'Could not complete that action'}
            </strong>
            <p>{error}</p>
            {!blocked && (
              <button className="text-button" onClick={() => setError('')}>
                Dismiss
              </button>
            )}
          </div>
        )}
        {blocked ? (
          <section className="card">
            <h1>Protect your saved data</h1>
            <p>
              The app will not overwrite unreadable data or changes from another
              tab.
            </p>
            <div className="row wrap">
              <button onClick={() => location.reload()}>Reload app</button>
              <button
                className="secondary"
                onClick={() =>
                  attempt(() => {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (!raw)
                      throw new Error('There is no saved data to export.');
                    download(raw, 'touchline-recovery.json');
                  })
                }
              >
                Download saved data
              </button>
              <button
                className="danger text-button"
                onClick={() => {
                  if (
                    confirm(
                      'Clear all saved app data? Download a recovery copy first.',
                    )
                  )
                    attempt(() => {
                      localStorage.removeItem(STORAGE_KEY);
                      location.reload();
                    });
                }}
              >
                Clear local data
              </button>
            </div>
          </section>
        ) : (
          <>
            {state.active && view !== 'game' && liveAlertDue && (
              <div className="sub-alert" role="status">
                <p className="eyebrow">Live game update</p>
                <p>
                  {state.active.notice !== null ||
                  state.active.pendingBlock !== null
                    ? 'A lineup change needs your attention.'
                    : state.active.clock.phase === 'halftime'
                      ? 'Halftime — review the second-half lineup.'
                      : 'Full time — confirm the result.'}
                </p>
                <button onClick={() => navigate('game')}>Open Live game</button>
              </div>
            )}
            {view === 'teams' && (
              <section>
                <div className="welcome">
                  <p className="eyebrow">A little planning. A better game.</p>
                  <h1>
                    Your team.
                    <br />
                    Your plan.
                    <br />
                    <span>Your game.</span>
                  </h1>
                  <p className="lead">
                    Fair rotations. Clear substitutions.
                    <br />
                    More time coaching.
                  </p>
                  <div className="welcome-pitch" aria-hidden="true">
                    <span />
                    <i />
                    <b />
                    <em />
                  </div>
                </div>
                <div className="section-heading">
                  <h2>Your teams</h2>
                  {state.teams.some((item) => item.archived) && (
                    <label className="inline-label">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(event) =>
                          setShowArchived(event.target.checked)
                        }
                      />
                      Show archived
                    </label>
                  )}
                </div>
                <div className="team-grid">
                  {state.teams
                    .filter((item) => showArchived || !item.archived)
                    .map((item) => (
                      <button
                        className="team-card"
                        key={item.id}
                        onClick={() => {
                          setTeamId(item.id);
                          navigate('team');
                        }}
                      >
                        <span className="team-avatar">
                          {item.name.slice(0, 2).toUpperCase()}
                        </span>
                        <strong>{item.name}</strong>
                        <span>
                          {item.players.length} players ·{' '}
                          {item.templates.length} plans
                          {item.archived ? ' · Archived' : ''}
                        </span>
                        <span className="team-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </button>
                    ))}
                </div>
                <form
                  className="card add-team"
                  onSubmit={(event) => {
                    event.preventDefault();
                    attempt(() => {
                      const newTeam: Team = {
                        id: uid(),
                        name: teamName.trim(),
                        archived: false,
                        players: [],
                        templates: [],
                      };
                      commit((previous) => ({
                        ...previous,
                        teams: [...previous.teams, newTeam],
                      }));
                      setTeamName('');
                      setTeamId(newTeam.id);
                      navigate('team');
                    });
                  }}
                >
                  <label className="grow">
                    Create a team
                    <input
                      required
                      maxLength={80}
                      value={teamName}
                      placeholder="e.g. Riverside U12"
                      onChange={(event) => setTeamName(event.target.value)}
                    />
                  </label>
                  <button>Add team</button>
                </form>
                <p className="hint">
                  Everything is saved on this device. No sign-in needed.
                </p>
              </section>
            )}
            {view === 'team' && team && (
              <TeamPage
                key={team.id}
                team={team}
                update={updateTeam}
                back={() => navigate('teams')}
                attempt={attempt}
                openPlan={(plan) => {
                  setTemplateId(plan?.id);
                  navigate('plan');
                }}
                setup={(plan) => {
                  if (state.active) {
                    setError(
                      'There is already an active game. End or discard it before starting another.',
                    );
                    return;
                  }
                  setTemplateId(plan.id);
                  navigate('setup');
                }}
              />
            )}
            {view === 'plan' && team && (
              <Planner
                key={templateId ?? 'new'}
                team={team}
                initial={template}
                attempt={attempt}
                cancel={() => navigate('team')}
                save={(plan) => {
                  commit((previous) => ({
                    ...previous,
                    teams: previous.teams.map((item) =>
                      item.id === team.id
                        ? {
                            ...item,
                            templates: item.templates.some(
                              (value) => value.id === plan.id,
                            )
                              ? item.templates.map((value) =>
                                  value.id === plan.id ? plan : value,
                                )
                              : [...item.templates, plan],
                          }
                        : item,
                    ),
                  }));
                  navigate('team');
                }}
              />
            )}
            {view === 'setup' && team && template && (
              <GameSetup
                key={template.id}
                team={team}
                template={template}
                attempt={attempt}
                cancel={() => navigate('team')}
                start={(plan, players, date, opponent) => {
                  const run = createRun(team, plan, players, date, opponent);
                  run.clock.anchor = Date.now();
                  commit((previous) => {
                    if (previous.active)
                      throw new Error('Only one game may be active.');
                    return { ...previous, active: run };
                  });
                  void enableSound().catch((error: unknown) =>
                    attempt(() => {
                      throw error;
                    }),
                  );
                  setRecovered(false);
                  navigate('game');
                }}
              />
            )}
            {view === 'game' && state.active && (
              <Game
                key={state.active.id}
                run={state.active}
                recovered={recovered}
                attempt={attempt}
                resumeSaved={() => {
                  mutateRun((run) => advance(run, Date.now(), true));
                  setRecovered(false);
                  void enableSound().catch((error: unknown) =>
                    attempt(() => {
                      throw error;
                    }),
                  );
                }}
                pause={() => mutateRun((run) => toggleClock(run, Date.now()))}
                secondHalf={(lineup) =>
                  mutateRun((run) => startSecondHalf(run, Date.now(), lineup))
                }
                accept={(lineup) =>
                  mutateRun((run) =>
                    acknowledge(advance(run, Date.now()), lineup),
                  )
                }
                editNext={(index, base, lineup, from) =>
                  mutateRun((run) => {
                    const next = advance(run, Date.now());
                    if (
                      from.length !== next.lineup.length ||
                      from.some((id, slot) => id !== next.lineup[slot])
                    )
                      throw new Error(
                        'The live lineup changed. Review the next planned block again.',
                      );
                    return editNextBlock(next, index, base, lineup);
                  })
                }
                discard={discard}
                complete={(scoreFor, scoreAgainst, notes) =>
                  attempt(() => {
                    commit((previous) => {
                      if (
                        !previous.active ||
                        previous.active.clock.phase !== 'fulltime'
                      )
                        throw new Error(
                          'Wait for full time before completing the game.',
                        );
                      return {
                        ...previous,
                        active: null,
                        history: [
                          ...previous.history,
                          {
                            run: previous.active,
                            scoreFor,
                            scoreAgainst,
                            notes,
                          },
                        ],
                      };
                    });
                    setRecovered(false);
                    navigate('history');
                  })
                }
              />
            )}
            {view === 'history' && (
              <History
                matches={state.history}
                teams={state.teams}
                update={(match) =>
                  attempt(() =>
                    commit((previous) => ({
                      ...previous,
                      history: previous.history.map((item) =>
                        item.run.id === match.run.id ? match : item,
                      ),
                    })),
                  )
                }
                remove={(id) =>
                  attempt(() =>
                    commit((previous) => ({
                      ...previous,
                      history: previous.history.filter(
                        (item) => item.run.id !== id,
                      ),
                    })),
                  )
                }
              />
            )}
            {view === 'settings' && (
              <Settings
                state={state}
                attempt={attempt}
                install={
                  installPrompt
                    ? () =>
                        attempt(() => {
                          setInstallPrompt(null);
                          void installPrompt.prompt().catch((error: unknown) =>
                            attempt(() => {
                              throw error;
                            }),
                          );
                        })
                    : null
                }
                replace={(next) => {
                  commit(() => next);
                  setRecovered(false);
                }}
                removeTeam={(id) =>
                  attempt(() => {
                    if (state.active?.teamId === id)
                      throw new Error(
                        "End or discard this team's active game before deleting it.",
                      );
                    if (
                      confirm(
                        'Permanently delete this team, roster, plans, and match history?',
                      )
                    )
                      commit((previous) => ({
                        ...previous,
                        teams: previous.teams.filter((item) => item.id !== id),
                        history: previous.history.filter(
                          (item) => item.run.teamId !== id,
                        ),
                      }));
                  })
                }
              />
            )}
          </>
        )}
      </main>
      <footer>Made for the touchline. Kept on your device.</footer>
    </>
  );
}
