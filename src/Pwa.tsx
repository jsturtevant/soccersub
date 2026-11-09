import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { loadState } from './storage';
import { message } from './useStore';

type InstallPromptEvent = Event & { prompt: () => Promise<unknown> };

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function';
}

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  useEffect(() => {
    let installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && navigator.standalone === true);
    const available = (event: Event) => {
      if (installed || !isInstallPrompt(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    const completed = () => {
      installed = true;
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', completed);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', completed);
    };
  }, []);
  return [installPrompt, setInstallPrompt] as const;
}

export function Pwa() {
  const [error, setError] = useState('');
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      console.error('Offline installation failed', error);
      setError(`Offline setup failed. ${message(error)}`);
    },
  });
  if (!offlineReady && !needRefresh && !error) return null;
  return (
    <aside
      className={`pwa-banner${needRefresh ? ' update-banner' : ''}`}
      aria-label="App availability"
      role="status"
    >
      {error ? (
        <p>{error}</p>
      ) : needRefresh ? (
        <>
          <p>
            A new version is ready. Finish the current game before updating
            here. Your browser may update after the app closes; the saved game
            stays on this device.
          </p>
          <button
            className="secondary"
            onClick={() => {
              try {
                if (loadState().active)
                  throw new Error(
                    'End or discard the active game before updating.',
                  );
                void updateServiceWorker(true).catch((error: unknown) => {
                  console.error('App update failed', error);
                  setError(message(error));
                });
              } catch (error) {
                console.error('App update blocked', error);
                setError(message(error));
              }
            }}
          >
            Update app
          </button>
        </>
      ) : offlineReady ? (
        <>
          <p>Ready to use offline on this device.</p>
          <button
            className="text-button"
            onClick={() => setOfflineReady(false)}
          >
            Dismiss
          </button>
        </>
      ) : null}
      {error && (
        <button className="text-button" onClick={() => setError('')}>
          Dismiss
        </button>
      )}
    </aside>
  );
}
