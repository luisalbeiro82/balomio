// Service worker de BaloMio — funcionamiento offline e instalación PWA.
// Sube CACHE cada vez que cambien los assets (va de la mano con ?v=N del index).
const CACHE = "balomio-v11";

// App shell + datos + SDK de Firebase (para que la app arranque sin conexión)
const PRECACHE = [
    "./",
    "index.html",
    "style.css?v=11",
    "script.js?v=11",
    "manifest.json",
    "sorteos-baloto.json",
    "sorteos-miloto.json",
    "icon-192.png",
    "icon-512.png",
    "favicon.png",
    "apple-touch-icon.png",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE)
            // addAll falla si algún recurso no responde 200; usamos allSettled por robustez
            .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(claves => Promise.all(claves.filter(c => c !== CACHE).map(c => caches.delete(c))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return; // no interceptar escrituras (Firestore/Auth)

    const url = new URL(req.url);
    // Peticiones dinámicas de Firebase (auth/firestore) van siempre a la red
    if (/googleapis\.com|firebaseio\.com|identitytoolkit|firestore\.googleapis/.test(url.host)) return;

    // HTML / navegación: RED PRIMERO, para recibir siempre la última versión.
    // (El resto de assets van versionados con ?v=N, así que caché primero es seguro.)
    const esHTML = req.mode === "navigate" ||
        (req.headers.get("accept") || "").includes("text/html");
    if (esHTML) {
        event.respondWith(
            fetch(req).then(resp => {
                const copia = resp.clone();
                caches.open(CACHE).then(cache => cache.put(req, copia));
                return resp;
            }).catch(() => caches.match(req).then(r => r || caches.match("index.html")))
        );
        return;
    }

    // Resto: caché primero, con respaldo a la red
    event.respondWith(
        caches.match(req).then(cacheado => {
            if (cacheado) return cacheado;
            return fetch(req).then(resp => {
                if (resp.ok && url.origin === self.location.origin) {
                    const copia = resp.clone();
                    caches.open(CACHE).then(cache => cache.put(req, copia));
                }
                return resp;
            }).catch(() => cacheado); // sin red y sin cache: falla silenciosa
        })
    );
});
