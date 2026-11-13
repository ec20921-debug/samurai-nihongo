// SAMURAI NIHONGO service worker — 本体をスマホに保存して、電波がなくても開けるようにする
const CACHE = 'snh-v11';
const SHELL = ['./', './index.html', './style.css?v=11', './app.js?v=11', './data.js?v=11', './road.js?v=11', './config.js?v=11', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './cars/car0.webp?v=1', './cars/car1.webp?v=1', './cars/car2.webp?v=1', './cars/car3.webp?v=1', './cars/car4.webp?v=1', './cars/car5.webp?v=1', './cars/car6.webp?v=1', './cars/car7.webp?v=1'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('snh-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 同じサイトのファイルはネット優先（更新をすぐ反映）。3秒で返事がなければ保存した分で開く（電波の弱い所で固まらないように）
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const fromCache = () => caches.match(e.request).then((r) => r || caches.match('./index.html'));
  const net = fetch(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' }).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  });
  const timeout = new Promise((res) => setTimeout(() => caches.match(e.request).then((r) => r && res(r)), 3000));
  e.respondWith(Promise.race([net.catch(fromCache), timeout]));
});
