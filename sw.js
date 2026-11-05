const CACHE_NAME = "kiosco-v3-biometric";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  // Inyectamos la librería de IA para que se guarde localmente
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js",
  "https://unpkg.com/lucide@latest",
  "https://unpkg.com/html5-qrcode",
  // Cacheamos los pesos de la Red Neuronal (Vital para offline)
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
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Ignorar peticiones de guardado del backend o de WhatsApp para no romper el caché
  if (e.request.url.includes("script.google.com")) {
    return fetch(e.request);
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request).catch(() => {
        // Fallback básico si todo falla offline
        return new Response("Contenido no disponible offline", {
          headers: { "Content-Type": "text/plain" }
        });
      });
    })
  );
});
