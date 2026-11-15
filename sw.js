// Service worker (alleen op de telefoon): bewaart de bestanden van de app zelf, zodat hij ook
// zonder bereik opent. Altijd eerst het netwerk (dan zie je meteen een nieuwe versie), bij geen
// bereik de bewaarde kopie. De gegevens zelf bewaart store-github.js; verzoeken naar GitHub
// komen hier niet langs.
const KAST = "mealplanning-app";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const kast = await caches.open(KAST);
    const bewaard = await kast.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: "no-cache" }).then((antwoord) => {
      if (antwoord.ok) kast.put(e.request, antwoord.clone());
      return antwoord;
    });
    if (!bewaard) return net;
    // Slecht bereik (supermarkt): niet blijven wachten, na 3 tellen de bewaarde kopie.
    const wacht = new Promise((ok) => setTimeout(() => ok(bewaard), 3000));
    return Promise.race([net.catch(() => bewaard), wacht]);
  })());
});
