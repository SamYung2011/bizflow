import { useSyncExternalStore } from 'react';
import { isStaffAppEmbed } from './appEmbed.js';

const embedded = isStaffAppEmbed(window.location.search);
let parentVisible = true;
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());
if (embedded) {
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin ||
        event.data?.type !== 'bizflow-app-visibility' || typeof event.data.visible !== 'boolean') return;
    parentVisible = event.data.visible;
    notify();
  });
  document.addEventListener('visibilitychange', notify);
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => !embedded || (parentVisible && document.visibilityState !== 'hidden');
export function useAppEmbedVisible() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
