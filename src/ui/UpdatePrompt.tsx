import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './primitives';

/**
 * Offline status and update prompt.
 *
 * Updates are opt-in rather than automatic: reloading mid-session would drop
 * the serial connection and whatever the operator was watching. Nobody wants
 * that to happen unannounced while they are standing at a panel.
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <div className="fixed right-4 bottom-10 z-40 max-w-sm rounded-lg border border-zinc-300 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
      <div className="text-sm text-zinc-800 dark:text-zinc-100">
        {needRefresh ? 'A new version is available.' : 'Ready to work offline.'}
      </div>
      {needRefresh && (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Reloading disconnects the serial port.
        </div>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={dismiss}>
          {needRefresh ? 'Later' : 'Got it'}
        </Button>
        {needRefresh && (
          <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
            Reload
          </Button>
        )}
      </div>
    </div>
  );
}
