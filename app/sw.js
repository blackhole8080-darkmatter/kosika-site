// Keeps Kosika on the phone, so it opens in airplane mode.
//
// Everything Kosika needs is saved the first time the app is opened online:
// the page, the engine (WebAssembly), the programs and the library for the
// phone's own model. After that the app is answered from this cache first,
// and a new build is fetched in the background when there is a network.
// The phone's model data (from Hugging Face) is kept by WebLLM in its own
// cache and is not touched here.

importScripts("build-id.js");
const CACHE = "kosika-app-" + self.KOSIKA_BUILD;
const SHELL = [
  "./", "index.html", "app.css", "app.js", "kosika.js", "models.js", "engine-worker.js", "build-id.js",
  "programs.json", "manifest.webmanifest", "engine/kosika.wasm", "engine/wasm_exec.js", "engine/web-llm.js",
  "icons/mark.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "../fonts/Figtree.ttf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kosika-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match("index.html"))),
  );
});
