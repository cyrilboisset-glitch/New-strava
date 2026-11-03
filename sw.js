// Service worker : appli utilisable hors ligne + réception des fichiers
// partagés depuis Gadgetbridge (menu Partager d'Android).
// Changer VERSION à chaque mise en ligne pour que le téléphone se mette à jour.
import { deposerPartage } from './js/db.js';

const VERSION = '0.1.0';
const CACHE = `mes-sorties-${VERSION}`;
const FICHIERS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/db.js', 'js/fit.js', 'js/import.js', 'js/sortie.js',
  'vendor/jszip.min.js',
  'fonts/barlow-condensed-latin-500-normal.woff2',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'icons/icone.svg', 'icons/icone-192.png', 'icons/icone-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const cle of await caches.keys()) if (cle !== CACHE) await caches.delete(cle);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method === 'POST' && url.pathname.endsWith('/partage')) {
    e.respondWith((async () => {
      const formulaire = await e.request.formData();
      for (const f of formulaire.getAll('fichiers')) {
        if (f && typeof f.arrayBuffer === 'function') await deposerPartage(f.name, await f.arrayBuffer());
      }
      return Response.redirect(new URL('./?partage=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const enCache = await caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    if (enCache) return enCache;
    try {
      return await fetch(e.request);
    } catch {
      if (e.request.mode === 'navigate') return caches.match('index.html');
      throw new Error('Hors ligne');
    }
  })());
});
