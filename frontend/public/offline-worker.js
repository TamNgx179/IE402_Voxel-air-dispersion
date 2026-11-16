const cacheName = 'ie402-offline-art-v1';
const fallbackUrl = new URL('offline-art', self.registration.scope).href;
const root = new URL(self.registration.scope);

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const artwork = event.data?.artwork;
  const loader = event.data?.loader;
  if (event.data?.type !== 'cache-offline-art' || !event.source?.url ||
      new URL(event.source.url).origin !== root.origin ||
      typeof artwork !== 'string' || artwork.length > 100000 ||
      !/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(artwork)) return;
  // Store one self-contained fallback. The map, tiles and API never enter this cache.
  const locale = event.data.locale === 'vi' ? 'vi' : 'en';
  const title = locale === 'vi' ? 'Đang chờ kết nối' : 'Waiting to reconnect';
  const hint = locale === 'vi' ? 'Bản đồ sẽ tự mở lại.' : 'The map will reopen automatically.';
  const loadingImage = typeof loader === 'string' && loader.length <= 35000 &&
    /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(loader)
    ? `<img class="loader" src="${loader}" alt="" width="54" height="30">` : '';
  const healthUrl = new URL('api/health', root).href;
  const page = `<!doctype html><html lang="${locale}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nguyen Hue Air Map</title>
<style>html{background:#eaf4f1}body{margin:0;min-height:100vh;display:grid;place-items:center;color:#163431;font-family:system-ui,sans-serif}main{text-align:center;padding:24px}h1{font-size:clamp(2rem,4vw,3.1rem);margin:8px 0 0;letter-spacing:-.035em}
.art{display:block;width:min(90vw,390px,70vh);height:auto;mask-image:linear-gradient(to right,transparent,#000 14%,#000 86%,transparent),linear-gradient(to bottom,transparent,#000 10%,#000 86%,transparent);mask-composite:intersect}
.loader{display:block;margin:auto}@media(prefers-reduced-motion:reduce){.loader{display:none}}</style>
<main aria-labelledby="offline-title"><img class="art" src="${artwork}" alt="" width="720" height="720">${loadingImage}<h1 id="offline-title">${title}</h1><p>${hint}</p></main>
<script>
let pending = false;
let timer;
async function reconnect() {
  if (pending) return;
  clearTimeout(timer);
  if (navigator.onLine) {
    pending = true;
    try {
      const response = await fetch(${JSON.stringify(healthUrl)}, { cache: 'no-store', signal: AbortSignal.timeout(4500) });
      if (response.ok && (await response.json()).status === 'ok') {
        location.replace(location.href);
        return;
      }
    } catch {
      // Keep waiting if the API has not recovered yet.
    } finally {
      pending = false;
    }
  }
  timer = setTimeout(reconnect, 4000);
}
window.addEventListener('online', reconnect);
reconnect();
</script></html>`;
  event.waitUntil(caches.open(cacheName).then((cache) => cache.put(fallbackUrl,
    new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET' ||
      url.origin !== root.origin || url.pathname !== root.pathname) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response.status < 500) return response;
      return (await (await caches.open(cacheName)).match(fallbackUrl)) ?? response;
    } catch {
      return (await (await caches.open(cacheName)).match(fallbackUrl)) ?? Response.error();
    }
  })());
});
