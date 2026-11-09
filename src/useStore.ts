import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyState, parseState, type AppState } from './domain';
import { loadState, saveState, STORAGE_KEY } from './storage';

export function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}

export function useStore() {
  const [loaded] = useState(() => {
    try {
      return { state: loadState(), error: '', blocked: false };
    } catch (error) {
      console.error('Unable to load local data', error);
      return {
        state: emptyState(),
        error: `Saved data could not be loaded. ${message(error)}`,
        blocked: true,
      };
    }
  });
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState(loaded.error);
  const [blocked, setBlocked] = useState(loaded.blocked);
  const current = useRef(state);
  const blockedRef = useRef(blocked);
  const saved = useRef<string | null>(null);
  const initialized = useRef(false);

  const commit = useCallback((update: (previous: AppState) => AppState) => {
    if (blockedRef.current)
      throw new Error(
        'Reload or recover your local data before making changes.',
      );
    if (
      initialized.current &&
      localStorage.getItem(STORAGE_KEY) !== saved.current
    ) {
      blockedRef.current = true;
      setBlocked(true);
      throw new Error(
        'Data changed in another tab. Reload this tab before making changes.',
      );
    }
    const next = parseState(update(current.current));
    saveState(next);
    saved.current = JSON.stringify(next);
    initialized.current = true;
    current.current = next;
    setState(next);
  }, []);

  const attempt = useCallback((action: () => void) => {
    try {
      action();
      setError('');
    } catch (error) {
      console.error('Unable to complete action', error);
      setError(message(error));
    }
  }, []);

  useEffect(() => {
    try {
      saved.current = localStorage.getItem(STORAGE_KEY);
      initialized.current = true;
    } catch (error) {
      blockedRef.current = true;
      setBlocked(true);
      setError(`Browser storage is not available. ${message(error)}`);
    }
    const changed = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        blockedRef.current = true;
        setBlocked(true);
        setError(
          'Data changed in another tab. Reload this tab to use the latest saved data.',
        );
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  return { state, current, commit, attempt, error, setError, blocked };
}
