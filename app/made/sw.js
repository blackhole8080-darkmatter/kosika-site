// Keeps an app Kosi made working offline once it is on the Home Screen.
// The app itself travels in the link (after the #), so this page is the
// only file to keep. Apps opened inside Kosika are in the "kosika-made"
// cache and are answered from there too.
const CACHE = "kosika-made-launcher-1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kosika-made-launcher-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
      // The launcher page is kept fresh when there is a network.
      if (r.ok && (url.pathname.endsWith("/made/") || url.pathname.endsWith("/made/index.html"))) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match("index.html"))),
  );
});
