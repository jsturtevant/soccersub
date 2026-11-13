import {
  parseCustomTimes,
  rotationStrategySchema,
  type Template,
} from './domain';
import {
  rotationStrategies,
  rotationStrategyIds,
  type RotationStrategy,
} from './rotations';
import { SubstitutionTimesPicker } from './SubstitutionTimesPicker';

export type PlanSettings = {
  strategy: RotationStrategy;
  interval: string;
  timing: 'repeating' | 'custom';
  firstHalf: string;
  secondHalf: string;
};

export function initialPlanSettings(plan?: Template): PlanSettings {
  const half = (plan?.duration ?? 3600) / 2;
  return {
    strategy: plan?.strategy ?? 'fair',
    interval: String((plan?.interval ?? 300) / 60),
    timing: plan?.customTimes === undefined ? 'repeating' : 'custom',
    firstHalf: (plan?.customTimes ?? [])
      .filter((at) => at > 0 && at < half)
      .map((at) => at / 60)
      .join(', '),
    secondHalf: (plan?.customTimes ?? [])
      .filter((at) => at > half)
      .map((at) => (at - half) / 60)
      .join(', '),
  };
}

export function samePlanSettings(a: PlanSettings, b: PlanSettings): boolean {
  if (a.strategy !== b.strategy) return false;
  const customA = a.strategy === 'manual' && a.timing === 'custom';
  const customB = b.strategy === 'manual' && b.timing === 'custom';
  return (
    customA === customB &&
    (customA
      ? a.firstHalf === b.firstHalf && a.secondHalf === b.secondHalf
      : a.interval === b.interval)
  );
}

export function planSchedule(settings: PlanSettings, total: number) {
  const custom = settings.strategy === 'manual' && settings.timing === 'custom';
  return {
    strategy: settings.strategy,
    interval: custom ? 300 : Number(settings.interval) * 60,
    customTimes: custom
      ? parseCustomTimes(total, settings.firstHalf, settings.secondHalf)
      : undefined,
  };
}

export function PlanSettingsFields({
  value,
  onChange,
  duration,
  attempt,
}: {
  value: PlanSettings;
  onChange: (value: PlanSettings) => void;
  duration: string;
  attempt: (action: () => void) => void;
}) {
  const manual = value.strategy === 'manual';
  return (
    <>
      <div className="full">
        <label>
          Rotation strategy
          <select
            value={value.strategy}
            aria-describedby="rotation-strategy-info"
            onChange={(event) =>
              onChange({
                ...value,
                strategy: rotationStrategySchema.parse(event.target.value),
              })
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
          {rotationStrategies[value.strategy].description}
        </p>
      </div>
      {manual && (
        <label className="full">
          Substitution schedule
          <select
            value={value.timing}
            onChange={(event) =>
              onChange({
                ...value,
                timing:
                  event.target.value === 'custom' ? 'custom' : 'repeating',
              })
            }
          >
            <option value="repeating">Repeating interval</option>
            <option value="custom">Specific times in each half</option>
          </select>
        </label>
      )}
      {manual && value.timing === 'custom' ? (
        <>
          <p className="hint full" id="custom-times-info">
            Each half is {Number(duration) / 2} minutes. Kickoff and halftime
            are included. Select no extra times for a half with no
            substitutions. Keep times at least 30 seconds apart and away from
            the start and end of the half.
          </p>
          <SubstitutionTimesPicker
            label="First-half substitution times"
            value={value.firstHalf}
            total={Number(duration) * 60}
            onChange={(firstHalf) => onChange({ ...value, firstHalf })}
            attempt={attempt}
          />
          <SubstitutionTimesPicker
            label="Second-half substitution times"
            value={value.secondHalf}
            total={Number(duration) * 60}
            onChange={(secondHalf) => onChange({ ...value, secondHalf })}
            attempt={attempt}
          />
        </>
      ) : (
        <label>
          Rotation every (minutes)
          <input
            type="number"
            min={0.5}
            max={120}
            step={0.5}
            value={value.interval}
            onChange={(event) =>
              onChange({ ...value, interval: event.target.value })
            }
          />
        </label>
      )}
    </>
  );
}
