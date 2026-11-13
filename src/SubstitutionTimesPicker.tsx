import { useId, useState } from 'react';
import { formatTime, parseCustomTimes } from './domain';

export function SubstitutionTimesPicker({
  label,
  value,
  total,
  onChange,
  attempt,
}: {
  label: string;
  value: string;
  total: number;
  onChange: (value: string) => void;
  attempt: (action: () => void) => void;
}) {
  const [exact, setExact] = useState('');
  const hintId = useId();
  const half =
    Number.isInteger(total) && total >= 120 && total <= 14400 && total % 2 === 0
      ? total / 2
      : null;
  const selected = value.trim() ? value.split(',').map(Number) : [];
  const step =
    half !== null && half <= 300 ? 30 : half !== null && half <= 900 ? 60 : 300;
  const suggestions =
    half === null
      ? []
      : Array.from(
          { length: Math.floor((half - 30) / step) },
          (_, index) => ((index + 1) * step) / 60,
        );
  const choices = [...new Set([...suggestions, ...selected])].sort(
    (a, b) => a - b,
  );
  const outOfRange =
    half !== null && selected.some((time) => time * 60 > half - 30);
  const change = (times: number[]) =>
    onChange([...times].sort((a, b) => a - b).join(', '));
  const add = (time: number) => {
    if (selected.includes(time))
      throw new Error('That substitution time is already selected.');
    const times = [...selected, time].sort((a, b) => a - b);
    parseCustomTimes(total, times.join(', '), '');
    change(times);
  };
  return (
    <fieldset className="time-picker full" aria-describedby={hintId}>
      <legend>{label}</legend>
      <p className="hint" id={hintId}>
        Tap a time to select or clear it. Times start from this half's kickoff.
      </p>
      {half === null && (
        <p className="warning" role="status">
          Enter a game length from 2 to 240 minutes before selecting times.
        </p>
      )}
      {outOfRange && (
        <p className="warning" role="status">
          Some selected times no longer fit this half. Remove them or increase
          the game length.
        </p>
      )}
      <div className="time-options">
        {choices.map((time) => (
          <button
            type="button"
            className="secondary"
            key={time}
            aria-pressed={selected.includes(time)}
            disabled={half === null && !selected.includes(time)}
            onClick={() =>
              selected.includes(time)
                ? change(selected.filter((item) => item !== time))
                : attempt(() => add(time))
            }
          >
            {formatTime(time * 60)}
          </button>
        ))}
      </div>
      <p className="hint time-summary" aria-live="polite">
        {selected.length
          ? `Selected: ${selected.map((time) => formatTime(time * 60)).join(', ')}`
          : 'No extra substitution times.'}
      </p>
      {selected.length > 0 && (
        <button
          type="button"
          className="text-button"
          onClick={() => change([])}
        >
          Clear times
        </button>
      )}
      <details>
        <summary>Add exact time</summary>
        <div className="time-exact">
          <label>
            Minutes into half
            <input
              type="number"
              inputMode="decimal"
              min={0.5}
              max={half === null ? undefined : (half - 30) / 60}
              step="any"
              value={exact}
              placeholder="12.5"
              onChange={(event) => setExact(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={half === null || !exact.trim()}
            onClick={() =>
              attempt(() => {
                add(Number(exact));
                setExact('');
              })
            }
          >
            Add time
          </button>
        </div>
        <p className="hint">
          For example, 12.5 means 12 minutes and 30 seconds.
        </p>
      </details>
    </fieldset>
  );
}
