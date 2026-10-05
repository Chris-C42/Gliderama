import { applyUpdate, offlineReady, updateAvailable } from '../../app/pwa';
import { useEffect, useState } from 'preact/hooks';

export function UpdateToast() {
  const [showOffline, setShowOffline] = useState(false);
  useEffect(() => {
    if (!offlineReady.value) return;
    setShowOffline(true);
    const t = setTimeout(() => setShowOffline(false), 3500);
    return () => clearTimeout(t);
  }, [offlineReady.value]);
  if (updateAvailable.value)
    return (
      <div class="toast card card--plain row">
        <span>A fresh fold of Gliderama is ready.</span>
        <button class="btn btn--primary btn--small" onClick={() => applyUpdate()}>
          Update
        </button>
      </div>
    );
  if (showOffline)
    return (
      <div class="toast">
        <span class="tape tape--green">Ready to fly offline</span>
      </div>
    );
  return null;
}
