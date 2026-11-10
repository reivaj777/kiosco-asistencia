const CACHE_NAME = "kiosco-v6-clean";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js?v=2027",
  "./manifest.json",
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js",
  "https://unpkg.com/lucide@latest",
  "https://unpkg.com/html5-qrcode",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/tiny_face_detector_model-weights_manifest.json",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/tiny_face_detector_model-shard1",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_landmark_68_model-weights_manifest.json",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_landmark_68_model-shard1",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-weights_manifest.json",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-shard1",
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-shard2"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Nunca interceptar peticiones POST ni llamadas hacia Google Apps Script
  if (e.request.method !== "GET" || e.request.url.includes("script.google.com")) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request).catch(() => {
        return new Response("Modo Offline Activo", { headers: { "Content-Type": "text/plain" } });
      });
    })
  );
});
