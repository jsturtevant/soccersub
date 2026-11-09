import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { loadState } from './storage';
import { message } from './useStore';

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
    <aside className="pwa-banner" aria-label="App availability" role="status">
      {error ? (
        <p>{error}</p>
      ) : needRefresh ? (
        <>
          <p>
            A new version is ready. Finish the current game before updating.
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
      ) : (
        <>
          <p>Ready to use offline on this device.</p>
          <button
            className="text-button"
            onClick={() => setOfflineReady(false)}
          >
            Dismiss
          </button>
        </>
      )}
      {error && (
        <button className="text-button" onClick={() => setError('')}>
          Dismiss
        </button>
      )}
    </aside>
  );
}
