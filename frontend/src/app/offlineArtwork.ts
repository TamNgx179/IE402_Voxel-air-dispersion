import bird from './connection-bird.webp.b64?raw';
import loader from './connection-loader.webp.b64?raw';

// Bundle the artwork with the viewer so a loaded tab needs no further image request.
export const offlineArtwork = 'data:image/webp;base64,' + bird.replace(/\s/g, '');
export const offlineLoader = 'data:image/webp;base64,' + loader.replace(/\s/g, '');

export async function cacheOfflineArtwork(locale: 'en' | 'vi') {
  if (!('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  try {
    await navigator.serviceWorker.register(base + 'offline-worker.js', { scope: base });
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'cache-offline-art', artwork: offlineArtwork, loader: offlineLoader, locale });
  } catch {
    // Browser storage can be unavailable. In-memory artwork still works in this tab.
  }
}
