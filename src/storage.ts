import { emptyState, parseState, type AppState } from './domain';

export const STORAGE_KEY = 'soccersub.v1';
export function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? emptyState() : parseState(JSON.parse(raw));
}
export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
export function exportBackup(state: AppState): string {
  return JSON.stringify(
    { version: 1, teams: state.teams, history: state.history, active: null },
    null,
    2,
  );
}
export function importBackup(
  text: string,
  active: AppState['active'],
): AppState {
  if (active)
    throw new Error(
      'End or discard the active game before importing a backup.',
    );
  if (text.length > 10_000_000)
    throw new Error('This backup is too large (maximum 10 MB).');
  const next = parseState(JSON.parse(text));
  if (next.active) throw new Error('Backups must not contain an active game.');
  return next;
}
