// Import d'une fausse archive Strava dans l'appli complète (Chromium à 390 px).
// Lancer depuis la racine du dépôt : node tests/test-strava-navigateur.cjs
// Données fabriquées (tests/fausse-archive.mjs) : pas besoin de vraies sorties.
// Captures dans tests/captures/ (non publiées).
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const RACINE = path.resolve(__dirname, '..');
const CAPTURES = path.join(__dirname, 'captures');
fs.mkdirSync(CAPTURES, { recursive: true });

const JSZip = (() => {
  const module = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(RACINE, 'vendor/jszip.min.js'), 'utf8'))(module, module.exports);
  return module.exports;
})();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
function serveur() {
  return new Promise((resoudre) => {
    const s = http.createServer((req, res) => {
      const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const fichier = path.join(RACINE, chemin.endsWith('/') ? chemin + 'index.html' : chemin);
      if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] ?? 'application/octet-stream' });
      fs.createReadStream(fichier).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resoudre(s));
  });
}

let echecs = 0;
const verif = (nom, ok, info = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${!ok && info ? ' — ' + info : ''}`); if (!ok) echecs++; };

async function texteToast(page) {
  await page.waitForSelector('#toast:not([hidden])', { timeout: 30000 });
  const t = await page.textContent('#toast');
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  return t;
}

(async () => {
  const { fauxGpx, fauxTcx, fauxFit, CSV_STRAVA, GPX_SANS_HORAIRES } = await import('./fausse-archive.mjs');
  const fit = Buffer.from(fauxFit());
  const zip = new JSZip();
  zip.file('activities.csv', CSV_STRAVA);
  zip.file('activities/111.fit.gz', zlib.gzipSync(fit));
  zip.file('activities/222.gpx', fauxGpx());
  zip.file('activities/333.tcx.gz', zlib.gzipSync(Buffer.from(fauxTcx())));
  zip.file('activities/444.gpx', GPX_SANS_HORAIRES);
  zip.file('routes/1.gpx', GPX_SANS_HORAIRES);
  zip.file('profile.csv', 'Email,First Name\nx@y,Test\n');
  const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const srv = await serveur();
  const URL_APPLI = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', timezoneId: 'Europe/Paris', locale: 'fr-FR' });
  const erreursConsole = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text()); });
  page.on('pageerror', (e) => erreursConsole.push(e.message));
  await page.goto(URL_APPLI);
  await page.waitForFunction(() => document.getElementById('synchro-titre').textContent !== 'Chargement…');
  verif("l'écran vide parle de l'archive Strava", (await page.textContent('#vide')).includes('archive Strava'));

  // 1. La sortie du 1er juin arrive d'abord par Gadgetbridge (FIT seul)
  await page.setInputFiles('#champ-fichier', { name: 'gadgetbridge.fit', mimeType: 'application/octet-stream', buffer: fit });
  verif('FIT seul importé', (await texteToast(page)).includes('1 nouvelle sortie'));
  verif('sans nom : titre = type de vélo', (await page.textContent('.sortie-nom')) === 'Vélo de route');

  // 2. Archive Strava
  await page.setInputFiles('#champ-fichier', { name: 'export_12345678.zip', mimeType: 'application/zip', buffer: zipBytes });
  const t = await texteToast(page);
  verif('archive : 6 nouvelles, 1 déjà connue', t.includes('6 nouvelles sorties') && t.includes('1 déjà connue') && !t.includes('illisible'), t);

  const sorties = await page.$$eval('.sortie', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  verif('7 sorties en tout', sorties.length === 7, String(sorties.length));
  const trouve = (nom) => sorties.find((s) => s.includes(nom)) ?? '';
  const attendus = {
    'Sortie du matin': ['Dim. 1 juin · 10:00', '30,0km', '1 h 00', '400m D+', '200 W NP', 'Vélo de route'],
    'Col du test': ['Sam. 10 mai · 09:00', '30,0km', '1 h 00', '180m D+', '200 W NP', '140 bpm', '30,0 km/h', 'Fichier GPX de Strava', '3 601 points'],
    Footing: ['Dim. 20 avr. · 11:00', '1,8km', '10 min', '250 W', '150 bpm', 'Course à pied', 'Fichier TCX de Strava'],
    'Home trainer sans capteur': ['Lun. 3 mars · 19:15', '25,0km', '59 min', 'Vélo virtuel', 'Sans trace'],
    'Fichier vide': ['Dim. 2 févr. · 11:00', '0,1km', '1 min'],
    'Séance haut du corps': ['Mer. 5 mars · 18:00', '45 min', 'Musculation'],
    Balade: ['Sam. 8 févr. · 14:00', '5,2km', '1 h 10', '40m D+', 'Marche'],
  };
  for (const [nom, morceaux] of Object.entries(attendus)) {
    const s = trouve(nom);
    verif(`« ${nom} » présente`, !!s);
    for (const m of morceaux) verif(`  « ${nom} » : ${m}`, s.includes(m), s);
  }
  const mois = await page.$$eval('.mois-titre', (els) => els.map((e) => e.textContent));
  verif('mois', JSON.stringify(mois) === JSON.stringify(['Juin 2025', 'Mai 2025', 'Avril 2025', 'Mars 2025', 'Février 2025']), JSON.stringify(mois));

  // Fichiers d'origine gardés (compressés tels quels)
  const fichiers = await page.evaluate(async () => {
    const req = indexedDB.open('mes-sorties', 1);
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tout = await new Promise((r) => { const q = db.transaction('fichiers').objectStore('fichiers').getAll(); q.onsuccess = () => r(q.result); });
    return tout.map((f) => `${f.id}:${f.format ?? 'fit'}:${f.gzip ? 'gz' : 'brut'}`).sort();
  });
  verif('fichiers stockés', JSON.stringify(fichiers) === JSON.stringify(['1234-1748764800000:fit:brut', 'strava-222:gpx:brut', 'strava-333:tcx:gz']), JSON.stringify(fichiers));

  await page.click('.sortie summary');
  await page.screenshot({ path: path.join(CAPTURES, 'strava-1-liste.png'), fullPage: true });
  verif('pas de défilement horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // 3. Même archive une seconde fois : rien de nouveau
  await page.setInputFiles('#champ-fichier', { name: 'export_12345678.zip', mimeType: 'application/zip', buffer: zipBytes });
  const t2 = await texteToast(page);
  verif('réimport : aucune nouvelle, 7 déjà connues', t2.includes('Aucune nouvelle sortie') && t2.includes('7 déjà connues'), t2);

  // 4. Tri par activité
  const filtres = async () => page.$$eval('.filtre', (els) => els.map((e) => `${e.textContent.replace(/\s+/g, ' ').trim()}${e.getAttribute('aria-pressed') === 'true' ? '*' : ''}`));
  const f1 = await filtres();
  verif('boutons de tri', JSON.stringify(f1) === JSON.stringify(['Tout 7*', 'Vélo 4', 'Course à pied 1', 'Marche 1', 'Musculation 1']), JSON.stringify(f1));
  await page.click('.filtre:has-text("Vélo")');
  await page.waitForFunction(() => document.querySelectorAll('.sortie').length === 4);
  const noms = await page.$$eval('.sortie-nom', (els) => els.map((e) => e.textContent));
  verif('Vélo : 4 sorties', JSON.stringify(noms) === JSON.stringify(['Sortie du matin', 'Col du test', 'Home trainer sans capteur', 'Fichier vide']), JSON.stringify(noms));
  const cumuls = await page.$$eval('.mois-cumul', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  verif('totaux du mois de mars sans la musculation', cumuls[2] === '1 sortie · 25,0 km · 59 min · 0 m D+', JSON.stringify(cumuls));
  verif('totaux de février sans la marche', cumuls[3] === '1 sortie · 0,1 km · 1 min · 0 m D+', JSON.stringify(cumuls));
  await page.screenshot({ path: path.join(CAPTURES, 'strava-2-tri-velo.png') });
  await page.reload();
  await page.waitForSelector('.filtre');
  verif('tri gardé après réouverture', (await filtres())[1] === 'Vélo 4*' && (await page.$$('.sortie')).length === 4, JSON.stringify(await filtres()));
  await page.click('.filtre:has-text("Musculation")');
  await page.waitForFunction(() => document.querySelectorAll('.sortie').length === 1);
  verif('Musculation : la séance', (await page.textContent('.sortie-nom')) === 'Séance haut du corps');
  await page.screenshot({ path: path.join(CAPTURES, 'strava-3-tri-musculation.png') });
  verif('pas de défilement horizontal avec les boutons', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // 5. Musculation importée par la v0.2 comme « Entraînement » : un réimport la corrige
  await page.evaluate(async () => {
    const req = indexedDB.open('mes-sorties', 1);
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tx = db.transaction('sorties', 'readwrite');
    const st = tx.objectStore('sorties');
    const q = st.get('strava-666');
    q.onsuccess = () => { const { typeStrava, ...reste } = q.result; st.put({ ...reste, sport: 10, sousSport: 0, nomSport: 'Entraînement' }); };
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await page.reload();
  await page.waitForSelector('.filtre');
  verif('ancienne version : rangée dans Entraînement', (await filtres()).includes('Entraînement 1'), JSON.stringify(await filtres()));
  await page.setInputFiles('#champ-fichier', { name: 'export_12345678.zip', mimeType: 'application/zip', buffer: zipBytes });
  verif('réimport sans doublon', (await texteToast(page)).includes('Aucune nouvelle sortie'));
  const f2 = await filtres();
  verif('réimport : remise dans Musculation', f2.includes('Musculation 1') && !f2.some((f) => f.startsWith('Entraînement')), JSON.stringify(f2));
  await page.click('.filtre:has-text("Tout")');

  // 6. Un .gpx seul (hors archive) : nom pris dans le fichier
  await page.evaluate(async () => {
    const req = indexedDB.open('mes-sorties', 1);
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tx = db.transaction(['sorties', 'fichiers'], 'readwrite');
    tx.objectStore('sorties').clear(); tx.objectStore('fichiers').clear();
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await page.setInputFiles('#champ-fichier', { name: 'sortie.gpx.gz', mimeType: 'application/gzip', buffer: zlib.gzipSync(Buffer.from(fauxGpx())) });
  verif('.gpx.gz seul importé', (await texteToast(page)).includes('1 nouvelle sortie'));
  verif('nom pris dans le GPX, type déduit', (await page.textContent('.sortie')).replace(/\s+/g, ' ').includes('Nom dans le GPX'));

  verif('aucune erreur dans la console', erreursConsole.length === 0, erreursConsole.join(' | '));
  await browser.close();
  srv.close();
  console.log(`\n${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})();
