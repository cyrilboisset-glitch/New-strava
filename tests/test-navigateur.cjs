// Test de l'appli dans un navigateur à la taille d'un téléphone (Playwright).
// Lancer depuis la racine du dépôt : node tests/test-navigateur.cjs
//
// Utilise la vraie sortie tests/donnees/sortie-2026-10-12.fit (non publiée) :
// sans elle, le test ne fait rien. Les valeurs attendues sont celles de
// cette sortie (12 oct. 2026, 15,6 km, 323 m D+, NP 165 W, FTP compteur 236 W).
// Captures d'écran dans tests/captures/ (non publiées).
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const RACINE = path.resolve(__dirname, '..');

// vendor/jszip.min.js est un script UMD ; le dépôt est en "type": "module",
// donc require() ne le reconnaît pas : on l'évalue comme un module CommonJS.
const JSZip = (() => {
  const module = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(RACINE, 'vendor/jszip.min.js'), 'utf8'))(module, module.exports);
  return module.exports;
})();
const FIT = path.join(__dirname, 'donnees/sortie-2026-10-12.fit');
const CAPTURES = path.join(__dirname, 'captures');

if (!fs.existsSync(FIT)) {
  console.log('tests/donnees/sortie-2026-10-12.fit absent : test ignoré.');
  process.exit(0);
}
fs.mkdirSync(CAPTURES, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
function serveur() {
  return new Promise((resoudre) => {
    const s = http.createServer((req, res) => {
      const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let fichier = path.join(RACINE, chemin.endsWith('/') ? chemin + 'index.html' : chemin);
      if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] ?? 'application/octet-stream' });
      fs.createReadStream(fichier).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resoudre(s));
  });
}

let echecs = 0;
const verif = (nom, ok, info = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${info ? ' — ' + info : ''}`); if (!ok) echecs++; };

async function texteToast(page) {
  await page.waitForSelector('#toast:not([hidden])', { timeout: 15000 });
  const t = await page.textContent('#toast');
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  return t;
}

(async () => {
  const fitBytes = fs.readFileSync(FIT);
  // Faux zip Gadgetbridge : base, réglages, le FIT deux fois, un faux .fit
  const zip = new JSZip();
  zip.file('database/Gadgetbridge', Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(2000)]));
  zip.file('preferences/global.xml', '<map></map>');
  zip.file('files/E3_7D_F2_46_D6_E8/2026-10-12T10_36_11+02_00-velo_de_route.fit', fitBytes);
  zip.file('files/E3_7D_F2_46_D6_E8/copie/autre-nom.fit', fitBytes);
  zip.file('files/cassé.fit', 'pas un fit du tout');
  const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const srv = await serveur();
  const URL_APPLI = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark',
    timezoneId: 'Europe/Paris', locale: 'fr-FR',
  });
  const erreursConsole = [];
  // Faux dossier Gadgetbridge (le vrai sélecteur de dossier ne s'automatise pas)
  await ctx.addInitScript(({ zip }) => {
    const octets = new Uint8Array(zip);
    const fichierZip = { kind: 'file', name: 'Gadgetbridge_2026-11-03.zip', getFile: async () => new File([octets], 'Gadgetbridge_2026-11-03.zip', { lastModified: 1762185600000 }) };
    const autre = { kind: 'file', name: 'notes.txt', getFile: async () => new File(['x'], 'notes.txt') };
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: 'Gadgetbridge',
      async *values() { yield autre; yield fichierZip; },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    });
  }, { zip: [...zipBytes] });

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) erreursConsole.push(m.text()); });
  page.on('pageerror', (e) => erreursConsole.push(e.message));

  await page.goto(URL_APPLI);
  await page.waitForFunction(() => document.getElementById('synchro-titre').textContent !== 'Chargement…');
  verif('état initial', (await page.textContent('#synchro-titre')) === 'Aucun dossier relié', await page.textContent('#synchro-titre'));
  verif('écran vide affiché', await page.isVisible('#vide'));
  verif('bouton synchro du haut caché sans dossier', !(await page.isVisible('#btn-synchro-haut')));
  await page.screenshot({ path: path.join(CAPTURES, '1-vide.png') });

  // 1. Import manuel du zip
  await page.setInputFiles('#champ-fichier', { name: 'Gadgetbridge_test.zip', mimeType: 'application/zip', buffer: zipBytes });
  const t1 = await texteToast(page);
  verif('import zip : 1 nouvelle, 1 doublon, 1 illisible', t1.includes('1 nouvelle sortie') && t1.includes('1 déjà connue') && t1.includes('1 fichier(s) illisible'), t1);
  const norm = (await page.textContent('.sortie')).replace(/\s+/g, ' ');
  for (const attendu of ['Vélo de route', 'Lun. 12 oct. · 10:36', '15,6', '58 min', '323', '165 W', 'TSS 48', '134']) {
    verif(`liste contient « ${attendu} »`, norm.includes(attendu), attendu);
  }
  verif('en-tête du mois', (await page.textContent('.mois-titre')) === 'Octobre 2026', await page.textContent('.mois-titre'));
  verif('cumul du mois', (await page.textContent('.mois-cumul')).replace(/\s+/g, ' ').includes('1 sortie · 15,6 km · 58 min · 323 m D+'), await page.textContent('.mois-cumul'));

  // 2. Même fichier .fit seul : déjà connu
  await page.setInputFiles('#champ-fichier', { name: 'sortie.fit', mimeType: 'application/octet-stream', buffer: fitBytes });
  const t2 = await texteToast(page);
  verif('réimport du .fit : pas de doublon', t2.includes('Aucune nouvelle sortie') && t2.includes('1 déjà connue'), t2);
  verif('toujours 1 sortie', (await page.$$('.sortie')).length === 1);

  // 3. Dossier : choix, synchro forcée (le zip contient 2 copies déjà connues)
  await page.click('#btn-dossier');
  const t3 = await texteToast(page);
  verif('synchro du dossier', t3.includes('Aucune nouvelle sortie') && t3.includes('2 déjà connues'), t3);
  verif('état dossier relié', (await page.textContent('#synchro-titre')).includes('Gadgetbridge'), await page.textContent('#synchro-titre'));
  verif('bouton synchro en haut visible', await page.isVisible('#btn-synchro-haut'));

  // 4. Synchro à nouveau : zip déjà lu
  await page.click('#btn-synchro-haut');
  verif('zip déjà lu', (await texteToast(page)).includes('Rien de nouveau'));

  // 5. Page de détail (pas de fond de carte ici : tuiles coupées)
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  await page.click('a.sortie');
  await page.waitForSelector('#page-detail .courbe');
  const details = (await page.textContent('#page-detail')).replace(/\s+/g, ' ');
  for (const attendu of ['16,1 km/h', '136 W', '446 W', '0,70', '157 bpm', '61 tr/min', '550 kcal', 'FTP de 236 W', '645 points']) {
    verif(`détail « ${attendu} »`, details.includes(attendu), attendu);
  }
  verif('détail : 3 tours', (await page.$$('.tours tbody tr')).length === 3);
  verif('détail : carte', !!(await page.$('#carte-parcours path.leaflet-interactive')));
  await page.screenshot({ path: path.join(CAPTURES, '2-sortie-sombre.png'), fullPage: true });
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');

  // 6. Plusieurs mois (résumés fictifs injectés, pour vérifier le regroupement)
  await page.evaluate(async () => {
    const { toutesLesSorties } = await import('./js/db.js');
    const [vraie] = await toutesLesSorties();
    const req = indexedDB.open('mes-sorties', 1);
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tx = db.transaction('sorties', 'readwrite');
    const decal = [[-9, 1.8, 'Gravel', 46], [-31, 0.6, 'Vélo de route', 7], [-35, 2.4, 'Vélo de route', 7], [-40, 1.1, 'Home trainer', 6]];
    decal.forEach(([jours, k, nom, ss], i) => {
      const trace = ss === 6 ? [] : vraie.trace.map(([a, b]) => [a + (i % 2 ? 0 : (b - vraie.trace[0][1]) * 0.3), b + (i % 2 ? (a - vraie.trace[0][0]) * 0.5 : 0)]);
      tx.objectStore('sorties').put({ ...vraie, id: `fictive-${i}`, debut: vraie.debut + jours * 86400000 + i * 3600000, nomSport: nom, sousSport: ss,
        distanceM: Math.round(vraie.distanceM * k), dureeChronoS: Math.round(vraie.dureeChronoS * k), denivelePosM: ss === 6 ? null : Math.round(vraie.denivelePosM * k),
        tss: Math.round(vraie.tss * k), trace });
    });
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await page.reload();
  await page.waitForSelector('.sortie');
  const mois = await page.$$eval('.mois-titre', (els) => els.map((e) => e.textContent));
  verif('regroupement par mois', JSON.stringify(mois) === JSON.stringify(['Octobre 2026', 'Septembre 2026']), JSON.stringify(mois));
  await page.screenshot({ path: path.join(CAPTURES, '3-liste-sombre.png'), fullPage: true });
  verif('pas de défilement horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // 7. Thème clair (contexte séparé, base vide)
  const pageClaire = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Europe/Paris', locale: 'fr-FR' });
  await pageClaire.goto(URL_APPLI);
  await pageClaire.waitForFunction(() => document.getElementById('synchro-titre').textContent !== 'Chargement…');
  await pageClaire.screenshot({ path: path.join(CAPTURES, '4-vide-clair.png') });

  // 8. Service worker + hors ligne
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15000 });
  await page.reload();
  verif('page contrôlée par le service worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.sortie', { timeout: 10000 });
  verif('fonctionne hors ligne', (await page.$$('.sortie')).length === 5);
  await ctx.setOffline(false);

  // 9. Partage depuis une autre appli (share target)
  await page.evaluate(async () => {
    const req = indexedDB.open('mes-sorties', 1);
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tx = db.transaction(['sorties', 'fichiers'], 'readwrite');
    tx.objectStore('sorties').clear(); tx.objectStore('fichiers').clear();
    await new Promise((r) => { tx.oncomplete = r; });
  });
  const statut = await page.evaluate(async (octets) => {
    const fd = new FormData();
    fd.append('fichiers', new File([new Uint8Array(octets)], 'velo.fit', { type: 'application/octet-stream' }));
    const r = await fetch('partage', { method: 'POST', body: fd, redirect: 'manual' });
    return r.type === 'opaqueredirect' ? 'redirection' : r.status;
  }, [...fitBytes]);
  verif('le service worker accepte le partage', statut === 'redirection', String(statut));
  await page.goto(URL_APPLI + '?partage=1');
  verif('fichier partagé importé', (await texteToast(page)).includes('1 nouvelle sortie'));
  verif('adresse nettoyée', !page.url().includes('partage'), page.url());

  verif('aucune erreur dans la console', erreursConsole.length === 0, erreursConsole.join(' | '));
  await browser.close();
  srv.close();
  console.log(`\n${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})();
