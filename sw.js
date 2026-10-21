// Service worker: aplicația merge și fără internet.
// Strategie: rețea întâi (ca să vezi mereu versiunea nouă), iar dacă nu există rețea, copia din cache.
const CACHE = "gantt-pro-v1";
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./css/style.css", "./css/fonts.css",
  "./js/data.js", "./js/calendar.js", "./js/cpm.js", "./js/gantt.js", "./js/tree.js",
  "./js/deps.js", "./js/toolbar.js", "./js/main.js",
  "./js/lib/html2canvas.min.js", "./js/lib/jspdf.umd.min.js",
  "./fonts/nunito-1.woff2", "./fonts/nunito-2.woff2", "./fonts/nunito-3.woff2",
  "./fonts/nunito-4.woff2", "./fonts/nunito-5.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
  );
});
