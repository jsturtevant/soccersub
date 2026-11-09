import { useEffect, useRef, useState } from 'react';
import { formatTime, type Match, type Run } from './domain';
import {
  actualSeconds,
  estimatedSeconds,
  nextSubstitutionIndex,
  recentArrivals,
  substitutions,
} from './engine';
import { Field, swapPlayer } from './Field';
import { Minutes } from './Planner';

function SubstitutionPairs({
  pairs,
  name,
  label,
}: {
  pairs: ReturnType<typeof substitutions>;
  name: (id: string) => string;
  label: string;
}) {
  if (pairs.length === 0) return <p>No bench changes</p>;
  return (
    <div role="list" aria-label={label}>
      {pairs.map(({ off, on }) => (
        <p className="sub-pair" role="listitem" key={off}>
          <span>
            <span className="sub-label off">OFF</span> {name(off)}
          </span>{' '}
          <span className="sub-arrow" aria-hidden="true">
            →
          </span>{' '}
          <span>
            <span className="sub-label on">ON</span> {name(on)}
          </span>
        </p>
      ))}
    </div>
  );
}

let audio: AudioContext | null = null;
export async function enableSound() {
  audio ??= new AudioContext();
  await audio.resume();
}

function tone() {
  if (!audio || audio.state !== 'running')
    throw new Error(
      'Sound is unavailable. Tap Enable sound and keep the app open.',
    );
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.frequency.value = 740;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.45);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.5);
}

export function useGameAlerts(
  run: Run | null,
  recovered: boolean,
  attempt: (action: () => void) => void,
) {
  const lastAlert = useRef('');
  const shouldAlert =
    !!run &&
    !recovered &&
    (run.notice !== null ||
      run.pendingBlock !== null ||
      run.clock.phase === 'halftime' ||
      run.clock.phase === 'fulltime');
  const alertKey = run
    ? `${run.id}:${run.pendingBlock}:${run.appliedBlock}:${run.notice?.missed}:${run.clock.phase}`
    : '';
  useEffect(() => {
    if (!shouldAlert || lastAlert.current === alertKey) return;
    lastAlert.current = alertKey;
    attempt(tone);
  }, [alertKey, attempt, shouldAlert]);
}

export function ResultForm({
  initial,
  submit,
  label = 'Save result',
}: {
  initial?: Match;
  submit: (
    scoreFor: number | null,
    scoreAgainst: number | null,
    notes: string,
  ) => void;
  label?: string;
}) {
  const [scoreFor, setScoreFor] = useState(initial?.scoreFor?.toString() ?? '');
  const [scoreAgainst, setScoreAgainst] = useState(
    initial?.scoreAgainst?.toString() ?? '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  return (
    <form
      className="card form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          scoreFor === '' ? null : Number(scoreFor),
          scoreAgainst === '' ? null : Number(scoreAgainst),
          notes,
        );
      }}
    >
      <label>
        Our score (optional)
        <input
          type="number"
          min={0}
          max={999}
          step={1}
          value={scoreFor}
          onChange={(event) => setScoreFor(event.target.value)}
        />
      </label>
      <label>
        Their score (optional)
        <input
          type="number"
          min={0}
          max={999}
          step={1}
          value={scoreAgainst}
          onChange={(event) => setScoreAgainst(event.target.value)}
        />
      </label>
      <label className="full">
        Match notes (optional)
        <textarea
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
        />
      </label>
      <button className="full" type="submit">
        {label}
      </button>
    </form>
  );
}

export function Game({
  run,
  recovered,
  resumeSaved,
  pause,
  secondHalf,
  accept,
  editNext,
  discard,
  complete,
  attempt,
}: {
  run: Run;
  recovered: boolean;
  resumeSaved: () => void;
  pause: () => void;
  secondHalf: (lineup: string[]) => boolean;
  accept: (lineup?: string[]) => boolean;
  editNext: (index: number, base: string[], lineup: string[]) => boolean;
  discard: () => void;
  complete: (
    scoreFor: number | null,
    scoreAgainst: number | null,
    notes: string,
  ) => void;
  attempt: (action: () => void) => void;
}) {
  const [editing, setEditing] = useState<string[] | null>(null);
  const [actualDraft, setActualDraft] = useState<{
    base: string[];
    lineup: string[];
  } | null>(null);
  const [editingSecondHalf, setEditingSecondHalf] = useState(false);
  const [nextDraft, setNextDraft] = useState<{
    index: number;
    base: string[];
    lineup: string[];
  } | null>(null);
  const actualLineup =
    actualDraft &&
    actualDraft.lineup.some((id, index) => id !== actualDraft.base[index])
      ? actualDraft.lineup
      : run.lineup;
  const staleActualDraft =
    actualDraft !== null &&
    actualDraft.base.some((id, index) => id !== run.lineup[index]) &&
    actualLineup.some((id, index) => id !== run.lineup[index]);
  const half = run.duration / 2;
  const unresolvedChanges = run.notice !== null || run.pendingBlock !== null;
  const phaseLabel = {
    first: 'First half',
    halftime: 'Halftime',
    second: 'Second half',
    fulltime: 'Full time',
  }[run.clock.phase];
  const currentHalf =
    run.clock.phase === 'first' || run.clock.phase === 'halftime'
      ? run.clock.elapsed
      : run.clock.elapsed - half;
  const target =
    run.pendingBlock !== null
      ? run.blocks[run.pendingBlock].lineup
      : run.lineup;
  const dueChanges = run.notice
    ? substitutions(run.notice.from, run.notice.to)
    : [];
  const halftimeTarget =
    run.blocks.find((block) => block.at === half)?.lineup ?? run.lineup;
  const nextIndex = nextSubstitutionIndex(run);
  const nextBlock = run.blocks[nextIndex];
  const staleNextDraft =
    nextDraft !== null &&
    (nextDraft.index !== nextIndex ||
      nextDraft.base.some(
        (id, slot) => id !== run.blocks[nextDraft.index]?.lineup[slot],
      ));
  const beginNextEdit = () => {
    if (!nextBlock) return;
    setNextDraft({
      index: nextIndex,
      base: [...nextBlock.lineup],
      lineup: [...nextBlock.lineup],
    });
  };
  const nextPairs = nextBlock
    ? substitutions(run.lineup, nextBlock.lineup)
    : [];
  const names = (ids: string[]) =>
    ids
      .map(
        (id) =>
          run.players.find((player) => player.id === id)?.name ??
          'Unknown player',
      )
      .join(', ');
  return (
    <section>
      <p className="eyebrow">
        {run.teamName}
        {run.opponent && ` vs ${run.opponent}`}
      </p>
      <div className="section-heading">
        <h1>Game day</h1>
        <span className="badge live">{phaseLabel}</span>
      </div>
      <div className="clock-card">
        <span className="eyebrow">{phaseLabel} elapsed</span>
        <div className="clock" aria-label="Current half elapsed">
          {formatTime(currentHalf)}
        </div>
        <p>
          Total match time{' '}
          <strong aria-label="Total elapsed">
            {formatTime(run.clock.elapsed)}
          </strong>
        </p>
        {!recovered &&
          (run.clock.phase === 'first' || run.clock.phase === 'second') && (
            <button
              className={run.clock.anchor === null ? '' : 'secondary'}
              onClick={pause}
            >
              {run.clock.anchor === null ? 'Resume clock' : 'Pause clock'}
            </button>
          )}
      </div>
      {recovered ? (
        <div className="card warning-panel">
          <h2>Unfinished game found</h2>
          <p>
            The clock keeps running while the app is closed, but stops at
            halftime and full time.
          </p>
          <div className="row">
            <button onClick={resumeSaved}>Resume saved game</button>
            <button className="danger secondary" onClick={discard}>
              Discard game
            </button>
          </div>
        </div>
      ) : (
        <>
          {run.notice && (
            <div className="sub-alert" role="status">
              <p className="eyebrow">
                {run.notice.missed
                  ? `${run.notice.missed} missed block${run.notice.missed > 1 ? 's' : ''} · caught up`
                  : 'Time to substitute'}
              </p>
              <h2>Next lineup is ready</h2>
              {dueChanges.length > 0 && (
                <SubstitutionPairs
                  pairs={dueChanges}
                  name={(id) => names([id])}
                  label="Substitutions"
                />
              )}
              {run.notice.missed > 0 && (
                <p className="hint">
                  Planned changes were assumed at their scheduled times. Correct
                  the current lineup below if needed.
                </p>
              )}
              <div className="row wrap">
                <button onClick={() => accept()}>Acknowledge changes</button>
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing([...target]);
                    setEditingSecondHalf(false);
                  }}
                >
                  Adjust lineup
                </button>
              </div>
            </div>
          )}
          {run.clock.phase === 'halftime' && (
            <div className="sub-alert">
              <p className="eyebrow">Take a break</p>
              <h2>Halftime</h2>
              <p>
                The clock is stopped. Review the second-half lineup before
                restarting.
              </p>
              <p>
                <strong>Second-half goalkeeper:</strong>{' '}
                {names([
                  (editingSecondHalf && editing ? editing : halftimeTarget)[0],
                ])}
              </p>
              <div className="row wrap">
                <button
                  onClick={() => {
                    const saved = secondHalf(
                      editingSecondHalf && editing ? editing : halftimeTarget,
                    );
                    if (saved) {
                      setEditing(null);
                      setEditingSecondHalf(false);
                    }
                  }}
                  disabled={unresolvedChanges}
                >
                  Start second half
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing([...halftimeTarget]);
                    setEditingSecondHalf(true);
                  }}
                >
                  Review halftime lineup
                </button>
              </div>
            </div>
          )}
          {run.clock.phase === 'fulltime' && (
            <>
              <h2>Full time. Well played.</h2>
              <p>Confirm the result to save this match in history.</p>
              <ResultForm submit={complete} label="Complete game" />
            </>
          )}
          {editing && (
            <div className="card">
              <h2>
                {editingSecondHalf
                  ? 'Second-half lineup'
                  : 'Adjust actual lineup'}
              </h2>
              <Field
                formationId={run.formationId}
                lineup={editing}
                players={run.players}
                onChange={(slot, id) =>
                  setEditing(swapPlayer(editing, slot, id))
                }
              />
              <div className="row">
                <button
                  onClick={() => {
                    const saved =
                      run.clock.phase === 'halftime' && editingSecondHalf
                        ? secondHalf(editing)
                        : accept(editing);
                    if (saved) {
                      setEditing(null);
                      setEditingSecondHalf(false);
                    }
                  }}
                  disabled={
                    run.clock.phase === 'halftime' &&
                    editingSecondHalf &&
                    unresolvedChanges
                  }
                >
                  {run.clock.phase === 'halftime' && editingSecondHalf
                    ? 'Apply and start second half'
                    : 'Apply actual lineup'}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(null);
                    setEditingSecondHalf(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <Field
        formationId={run.formationId}
        lineup={run.lineup}
        players={run.players}
        label="Live lineup"
        recentlyOn={recentArrivals(run)}
        nextLineup={
          !recovered && run.clock.phase !== 'fulltime'
            ? nextBlock?.lineup
            : undefined
        }
      />
      <div className="bench">
        <span className="eyebrow">On the bench</span>
        <p>
          {names(
            run.players
              .filter((player) => !run.lineup.includes(player.id))
              .map((player) => player.id),
          ) || 'Everyone is on the field'}
        </p>
      </div>
      {!recovered && nextBlock && run.clock.phase !== 'fulltime' && (
        <div className="card next-change">
          <span className="eyebrow">
            Next planned block · match {formatTime(nextBlock.at)}
          </span>
          {nextBlock.at === half && <p>Halftime lineup</p>}
          <SubstitutionPairs
            pairs={nextPairs}
            name={(id) => names([id])}
            label="Upcoming substitutions"
          />
          {!nextDraft && (
            <button className="secondary" onClick={beginNextEdit}>
              Edit next substitutions
            </button>
          )}
          {nextDraft && (
            <>
              <h2>Edit next substitutions</h2>
              <p className="hint">
                Choose a bench player, or keep a player who was due to come off.
                The live lineup stays unchanged until this block is applied.
              </p>
              <Field
                label="Next lineup editor"
                formationId={run.formationId}
                lineup={nextDraft.lineup}
                players={run.players}
                onChange={
                  staleNextDraft
                    ? undefined
                    : (slot, id) =>
                        setNextDraft({
                          ...nextDraft,
                          lineup: swapPlayer(nextDraft.lineup, slot, id),
                        })
                }
              />
              {staleNextDraft && (
                <div className="warning" role="status">
                  <p>The next block changed. Your edits are kept here.</p>
                  <button className="secondary" onClick={beginNextEdit}>
                    Use next planned block
                  </button>
                </div>
              )}
              <div className="row wrap">
                <button
                  disabled={staleNextDraft}
                  onClick={() => {
                    if (
                      editNext(
                        nextDraft.index,
                        nextDraft.base,
                        nextDraft.lineup,
                      )
                    )
                      setNextDraft(null);
                  }}
                >
                  Save next substitutions
                </button>
                <button
                  className="text-button"
                  onClick={() => setNextDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!recovered && run.clock.phase !== 'fulltime' && (
        <>
          <div className="row wrap">
            <button
              className="secondary"
              onClick={() =>
                attempt(() => {
                  void enableSound().catch((error: unknown) =>
                    attempt(() => {
                      throw error;
                    }),
                  );
                })
              }
            >
              Enable sound
            </button>
          </div>
          <p className="hint">
            Keep the app open to hear alerts. Background alerts are not
            supported.
          </p>
          <details
            className="card"
            onToggle={(event) => {
              if (!event.currentTarget.open) setActualDraft(null);
            }}
          >
            <summary>Adjust actual lineup</summary>
            <Field
              formationId={run.formationId}
              lineup={actualLineup}
              players={run.players}
              onChange={
                staleActualDraft
                  ? undefined
                  : (slot, id) =>
                      setActualDraft({
                        base: [...run.lineup],
                        lineup: swapPlayer(actualLineup, slot, id),
                      })
              }
            />
            {staleActualDraft && (
              <div className="warning" role="status">
                <p>
                  The live lineup changed. Your edits are kept here. Use the
                  current lineup to review the correction again.
                </p>
                <button
                  className="secondary"
                  onClick={() => setActualDraft(null)}
                >
                  Use current lineup
                </button>
              </div>
            )}
            <button
              disabled={staleActualDraft}
              onClick={() => accept(actualLineup)}
            >
              Apply actual lineup
            </button>
          </details>
        </>
      )}
      <details className="card">
        <summary>Playing time so far</summary>
        <Minutes players={run.players} totals={actualSeconds(run)} />
      </details>
      <details className="card">
        <summary>Estimated playing time</summary>
        <p className="hint">
          Expected totals at full time, using actual play so far and the
          remaining planned lineups. Pending changes are assumed to happen now.
        </p>
        <Minutes players={run.players} totals={estimatedSeconds(run)} />
      </details>
      {!recovered && (
        <button className="text-button danger" onClick={discard}>
          Discard this game
        </button>
      )}
    </section>
  );
}
