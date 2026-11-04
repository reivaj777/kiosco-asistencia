const CACHE_NAME = "asistencia-pwa-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/lucide@latest",
  "https://unpkg.com/html5-qrcode"
];

// Instalar y guardar en caché
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)));
});

// Interceptar peticiones
self.addEventListener("fetch", (event) => {
  // NUNCA cachear las llamadas a la API de Google Apps Script
  if (event.request.url.includes("script.google.com")) {
    return;
  }
  
  // Para el resto (UI, Scripts), devolver desde caché o descargar si no está
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
