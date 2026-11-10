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

// PNG 256 × 256 beige quadrillé (fausse tuile de carte)
function fausseTuile() {
  const L = 256;
  const brut = Buffer.alloc((L * 3 + 1) * L);
  for (let y = 0; y < L; y++) {
    brut[y * (L * 3 + 1)] = 0;
    for (let x = 0; x < L; x++) {
      const ligne = x % 64 === 0 || y % 64 === 0;
      const o = y * (L * 3 + 1) + 1 + x * 3;
      brut[o] = ligne ? 200 : 242; brut[o + 1] = ligne ? 196 : 239; brut[o + 2] = ligne ? 186 : 233;
    }
  }
  const bloc = (type, data) => {
    const t = Buffer.from(type);
    const lg = Buffer.alloc(4); lg.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([lg, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(L, 0); ihdr.writeUInt32BE(L, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
}

let echecs = 0;
const verif = (nom, ok, info = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${!ok && info ? ' — ' + info : ''}`); if (!ok) echecs++; };

// Attend qu'une condition calculée dans la page (fonction async) soit vraie
async function attendre(page, f, arg, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await page.evaluate(f, arg)) return true;
    await page.waitForTimeout(250);
  }
  throw new Error(`attente dépassée : ${f.toString().slice(0, 120)}`);
}

// Ouvre le menu repliable d'un bloc (segments, même parcours) s'il est fermé
async function ouvrirRepli(page, bloc) {
  // la page peut être redessinée entre-temps : on réessaie jusqu'à trouver le menu ouvert
  await page.waitForFunction((b) => {
    const d = document.querySelector(`${b} details.repli`);
    if (!d) return false;
    if (!d.open) d.querySelector('summary').click();
    return d.open;
  }, bloc, { timeout: 15000, polling: 200 });
}

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
  // Tuiles OpenStreetMap injoignables ici : le test sert une fausse tuile (beige quadrillé)
  const tuilesDemandees = [];
  // Faux BRouter : ligne droite entre les points, altitude qui monte de 3 % ;
  // le profil « safety » simule une panne de réseau
  const demandesBRouter = [];
  // Fausse météo Open-Meteo : vent de nord-est, fort (25 km/h) avant 12 h UTC, faible (8 km/h) après ;
  // pluie probable (80 %) à 15 h et 16 h UTC
  const demandesMeteo = [];
  await ctx.route(/api\.open-meteo\.com/, (r) => {
    const u = new URL(r.request().url());
    demandesMeteo.push(u.toString());
    const n = u.searchParams.get('latitude').split(',').length;
    const debut = Date.parse(`${u.searchParams.get('start_date')}T00:00:00Z`) / 1000;
    const fin = Date.parse(`${u.searchParams.get('end_date')}T23:00:00Z`) / 1000;
    const time = []; for (let t = debut; t <= fin; t += 3600) time.push(t);
    const h = (t) => new Date(t * 1000).getUTCHours();
    // température comme Open-Meteo à l'altitude demandée : 15 °C au niveau de la mer, −6,5 °C par 1 000 m
    const alts = (u.searchParams.get('elevation') ?? '').split(',').map(Number);
    const lieu = (k) => ({ elevation: alts[k], hourly: { time, temperature_2m: time.map(() => 15 - 0.0065 * (alts[k] || 0)), wind_speed_10m: time.map((t) => (h(t) < 12 ? 25 : 8)),
      wind_direction_10m: time.map(() => 45), wind_gusts_10m: time.map(() => 30), precipitation_probability: time.map((t) => (h(t) === 15 || h(t) === 16 ? 80 : 0)) } });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(n === 1 ? lieu(0) : Array.from({ length: n }, (_, k) => lieu(k))) });
  });
  // Faux OpenStreetMap : commune « Ville <lat × 100> » ; col « Col du Test » à la longitude 5,7, vers 45,07
  const demandesLieux = [];
  await ctx.route(/nominatim\.openstreetmap\.org|overpass-api\.de/, (r) => {
    const u = new URL(r.request().url());
    demandesLieux.push(u.toString());
    let corps;
    if (u.host.includes('nominatim')) corps = { address: { town: `Ville ${Math.round(Number(u.searchParams.get('lat')) * 100)}` } };
    else {
      const m = u.searchParams.get('data').match(/around:\d+,([\d.]+),([\d.]+)/);
      const la = Number(m[1]); const lo = Number(m[2]);
      corps = { elements: Math.abs(lo - 5.7) < 1e-4 && la > 45.06 && la < 45.085 ? [{ type: 'node', lat: la, lon: lo, tags: { mountain_pass: 'yes', name: 'Col du Test' } }] : [] };
    }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(corps) });
  });
  await ctx.route(/brouter\.de\/brouter/, (r) => {
    const u = new URL(r.request().url());
    demandesBRouter.push(u.searchParams.get('profile'));
    if (u.searchParams.get('profile') === 'safety') { r.abort(); return; }
    const pts = u.searchParams.get('lonlats').split('|').map((x) => x.split(',').map(Number));
    const coords = [];
    let d = 0;
    // longueur totale d'abord : l'altitude monte à 3 % puis redescend (vraie boucle)
    let total = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const kx0 = Math.cos(((pts[k][1] + pts[k + 1][1]) / 2) * Math.PI / 180);
      total += Math.hypot((pts[k + 1][1] - pts[k][1]) * 111195, (pts[k + 1][0] - pts[k][0]) * 111195 * kx0);
    }
    const alt = (x) => 200 + Math.min(x, total - x) * 0.03;
    for (let k = 0; k < pts.length - 1; k++) {
      const [lo1, la1] = pts[k]; const [lo2, la2] = pts[k + 1];
      const kx = Math.cos(((la1 + la2) / 2) * Math.PI / 180);
      const long = Math.hypot((la2 - la1) * 111195, (lo2 - lo1) * 111195 * kx);
      const n = Math.max(2, Math.round(long / 20));
      for (let i = k ? 1 : 0; i <= n; i++) {
        const f = i / n;
        coords.push([lo1 + (lo2 - lo1) * f, la1 + (la2 - la1) * f, alt(d + long * f)]);
      }
      d += long;
    }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'track-length': String(Math.round(d)), 'filtered ascend': String(Math.round((d / 2) * 0.03)) }, geometry: { type: 'LineString', coordinates: coords } }] }) });
  });
  await ctx.route(/tile\.openstreetmap\.org/, (r) => { tuilesDemandees.push(r.request().url()); r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: fausseTuile() }); });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|tile\.openstreetmap/.test(m.text() + (m.location()?.url ?? ''))) erreursConsole.push(m.text()); });
  page.on('pageerror', (e) => { erreursConsole.push(e.message); if (process.env.PILE) console.log('PILE', e.stack); });
  await page.goto(URL_APPLI);
  await page.waitForFunction(() => document.getElementById('synchro-titre').textContent !== 'Chargement…');
  verif("l'écran vide parle de l'archive Strava", (await page.textContent('#vide')).includes('archive Strava'));

  // Menu « Synchro » : fermé au départ, s'ouvre, propose les actions, se ferme
  verif('menu Synchro fermé', !(await page.isVisible('#menu-synchro')) && (await page.getAttribute('#btn-menu-synchro', 'aria-expanded')) === 'false');
  verif('bouton Synchro : « À régler » sans dossier', (await page.textContent('#synchro-court')) === 'À régler', await page.textContent('#synchro-court'));
  await page.click('#btn-menu-synchro');
  await page.waitForFunction(() => document.getElementById('menu-synchro').classList.contains('ouvert'));
  await page.waitForTimeout(250); // fin du fondu d'ouverture (capture)
  const actions = await page.$$eval('#menu-synchro .menu-item:not([hidden])', (els) => els.map((e) => e.firstElementChild.nextElementSibling.firstChild.textContent.trim()));
  verif('actions du menu sans dossier', JSON.stringify(actions) === JSON.stringify(['Choisir le dossier Gadgetbridge', 'Importer un fichier', 'Restaurer une sauvegarde']), JSON.stringify(actions));
  verif('état dans le menu', (await page.textContent('#menu-synchro .menu-etat')).includes('Aucun dossier relié'));
  await page.screenshot({ path: path.join(CAPTURES, 'accueil-menu-synchro.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu-synchro', { state: 'hidden', timeout: 2000 }).catch(() => {});
  verif('Échap ferme le menu (en fondu)', !(await page.isVisible('#menu-synchro')));
  await page.click('#btn-menu-synchro');
  await page.mouse.click(20, 600);
  await page.waitForSelector('#menu-synchro', { state: 'hidden', timeout: 2000 }).catch(() => {});
  verif('toucher ailleurs ferme le menu', !(await page.isVisible('#menu-synchro')));
  await page.click('#btn-menu-synchro');
  const [choixFichier] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-importer')]);
  await page.waitForSelector('#menu-synchro', { state: 'hidden', timeout: 2000 }).catch(() => {});
  verif('« Importer un fichier » ouvre le choix de fichier, menu refermé', choixFichier.isMultiple() && !(await page.isVisible('#menu-synchro')));
  verif('menu Activité inactif sans sortie', await page.$eval('#btn-activite', (s) => s.disabled));

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
    'Col du test': ['Sam. 10 mai · 09:00', '30,0km', '1 h 00', '180m D+', '200 W NP', 'TSS 72', '140 bpm', '30,0 km/h', 'Fichier GPX de Strava', '3 601 points'],
    Footing: ['Dim. 20 avr. · 11:00', '1,8km', '10 min', '250 W', '150 bpm', 'Course à pied', 'Fichier TCX de Strava'],
    'Home trainer sans capteur': ['Lun. 3 mars · 19:15', '25,0km', '59 min', 'Vélo virtuel', 'Sans trace'],
    'Fichier vide': ['Dim. 2 févr. · 11:00', '0,1km', '1 min'],
    'Séance haut du corps': ['Mer. 5 mars · 18:00', '45 min', 'Musculation'],
    Balade: ['Sam. 8 févr. · 14:00', '5,2km', '1 h 10', '40m D+', 'Marche'],
  };
  // Chaque sortie : sa carte dans la liste + sa page de détail
  for (const [nom, morceaux] of Object.entries(attendus)) {
    const s = trouve(nom);
    verif(`« ${nom} » présente`, !!s);
    await page.click(`a.sortie:has-text("${nom}")`);
    await page.waitForSelector('#page-detail .detail-nom');
    const detail = (await page.textContent('#page-detail')).replace(/\s+/g, ' ');
    for (const m of morceaux) verif(`  « ${nom} » : ${m}`, (s + ' ' + detail).includes(m), s + ' || ' + detail);
    await page.click('#btn-retour');
    await page.waitForSelector('#accueil:not([hidden])');
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

  await page.screenshot({ path: path.join(CAPTURES, 'strava-1-liste.png'), fullPage: true });

  // 2 bis. Détail de « Col du test » : carte, courbes, curseur, efforts, zones
  await page.click('a.sortie:has-text("Col du test")');
  await page.waitForSelector('#page-detail .courbe');
  verif('adresse du détail', page.url().includes('#sortie=strava-222'), page.url());
  verif('titre de la barre', (await page.textContent('#titre-page')) === 'Sortie');
  verif('carte du parcours avec la trace', await page.$eval('#carte-parcours', (c) => !!c.querySelector('path.leaflet-interactive')));
  const courbes = await page.$$eval('.courbe-titre', (els) => els.map((e) => e.textContent.trim()));
  verif('courbes', JSON.stringify(courbes) === JSON.stringify(['Altitude', 'Vitesse', 'Puissance', 'Fréquence cardiaque', 'Cadence']), JSON.stringify(courbes));
  const valeurs = await page.$$eval('.courbe-valeur', (els) => els.map((e) => e.textContent));
  verif('moyennes par défaut', JSON.stringify(valeurs) === JSON.stringify(['', 'moy. 30,0 km/h', 'moy. 200 W', 'moy. 140 bpm', 'moy. 90 tr/min']), JSON.stringify(valeurs));
  // Doigt posé au milieu de la courbe de puissance
  await page.waitForFunction(() => !document.documentElement.dataset.transition); // fin du glissement
  const zone = await page.$('.courbe[data-champ="puissanceW"] .courbe-zone');
  await zone.scrollIntoViewIfNeeded();
  const r = await zone.boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  const position = await page.textContent('.courbes-position');
  verif('curseur au milieu : 15 km, 30 min', position.replace(/\s+/g, ' ') === '15,0 km · 30:00', position);
  const auCurseur = await page.$$eval('.courbe-valeur', (els) => els.map((e) => e.textContent));
  verif('valeurs au curseur', JSON.stringify(auCurseur) === JSON.stringify(['280 m', '30,0 km/h', '200 W', '140 bpm', '90 tr/min']), JSON.stringify(auCurseur));
  verif('curseur visible sur toutes les courbes', (await page.$$('.curseur:not([hidden])')).length === 5);
  verif('thème sombre : carte du détail claire (sans filtre)', await page.evaluate(() => getComputedStyle(document.querySelector('#carte-parcours .leaflet-tile-pane')).filter === 'none'));
  verif('point du curseur sur la carte',await page.evaluate(() => [...document.querySelectorAll('#carte-parcours path.leaflet-interactive')].length >= 4));
  const detail = (await page.textContent('#page-detail')).replace(/\s+/g, ' ');
  for (const m of ['5 s 200 W', '1 min 200 W', '20 min 200 W', '1 h 200 W', 'Puissance normalisée200 W', "Facteur d'intensité0,85", 'TSS72',
    'Z3 Tempo178–212 W 1 h 00100 %', 'Z5 Maximum> 135 bpm 1 h 00100 %', 'FTP de 236 W', 'FC max de 150 bpm (la plus haute relevée']) {
    verif(`détail : « ${m} »`, detail.includes(m), detail);
  }
  await page.mouse.move(5, 5);
  await page.screenshot({ path: path.join(CAPTURES, 'detail-1-sombre.png'), fullPage: true });
  verif('détail : pas de défilement horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  // Efforts gardés dans la sortie (pour l'estimation de la FTP)
  const efforts = await page.evaluate(async () => (await (await import('./js/db.js')).lireSortie('strava-222')).effortsW);
  verif('efforts gardés', efforts?.[1200] === 200, JSON.stringify(efforts));

  // Vue 3D : bascule Carte / 3D, dessin, relief, survol relié aux courbes
  verif('carte par défaut, 3D cachée', await page.isVisible('#carte-parcours') && !(await page.isVisible('#vue3d')));
  await page.click('[data-segments="vue"] button[data-valeur="3d"]');
  await page.waitForTimeout(400);
  verif('3D affichée, carte cachée', await page.isVisible('#vue3d') && !(await page.isVisible('#carte-parcours')));
  const pixels = await page.$eval('#vue3d canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  verif('ruban 3D dessiné', pixels > 5000, String(pixels));
  verif('légende des pentes', (await page.textContent('.v3d-legende')).includes('> 10 %'));
  await page.click('[data-v3d="relief"]');
  verif('relief ×1', (await page.textContent('[data-v3d="relief"] span')) === '×1');
  await page.click('[data-v3d="survol"]');
  verif('survol lancé', (await page.textContent('[data-v3d="survol"]')).includes('Arrêter'));
  await page.waitForTimeout(1500);
  const pendantSurvol = (await page.textContent('.courbes-position')).replace(/\s+/g, ' ');
  verif('survol : les courbes suivent', /^\d+,\d km · \d+:\d\d$/.test(pendantSurvol), pendantSurvol);
  await page.screenshot({ path: path.join(CAPTURES, 'detail-3d.png') });
  await page.click('[data-v3d="survol"]');
  verif('survol arrêté', (await page.textContent('[data-v3d="survol"]')).includes('Survol'));
  // Altitude colorée selon la pente
  verif('altitude colorée selon la pente', (await page.$$('.courbe[data-champ="altitudeM"] .courbe-pentes rect')).length > 250);
  await page.click('[data-segments="vue"] button[data-valeur="carte"]');

  // Segments : création à la main sur « Col du test » (du km 10 au km 20 environ)
  await page.waitForSelector('#bloc-segments-sortie details.repli', { state: 'attached' });
  verif('segments : menu replié par défaut, résumé « Aucun segment »', await page.$eval('#bloc-segments-sortie details.repli', (d) => !d.open)
    && (await page.textContent('#bloc-segments-sortie summary')).includes('Aucun segment'));
  await ouvrirRepli(page, '#bloc-segments-sortie');
  verif('segments : aucun au départ', (await page.textContent('#bloc-segments-sortie')).includes('Aucun segment sur cette sortie'));
  verif('pas de montée ni de sprint détectés (1,2 %, 200 W)', !(await page.$('#bloc-segments-sortie .proposition')));
  await page.click('#bloc-segments-sortie .creation summary');
  const zoneP = await page.$('.courbe[data-champ="puissanceW"] .courbe-zone');
  await zoneP.scrollIntoViewIfNeeded();
  const rz = await zoneP.boundingBox();
  await page.mouse.click(rz.x + rz.width / 3, rz.y + 40);
  await page.click('[data-choix="debut"]');
  await zoneP.scrollIntoViewIfNeeded();
  const rz2 = await zoneP.boundingBox();
  await page.mouse.click(rz2.x + (rz2.width * 2) / 3, rz2.y + 40);
  await page.click('[data-choix="fin"]');
  await page.waitForFunction(() => document.getElementById('nom-segment').value !== '', null, { timeout: 10000 });
  const nomManuel = await page.inputValue('#nom-segment');
  verif('nom proposé pour le segment à la main (plat entre deux communes)', /^Ville \d+ → Ville \d+$/.test(nomManuel), nomManuel);
  const choixTxt = (await page.textContent('#bloc-segments-sortie .creation')).replace(/\s+/g, ' ');
  verif('départ et arrivée choisis (km 10 et km 20)', /Départ : km 10,0\d · Arrivée : km 20,0\d · 10,0 km/.test(choixTxt), choixTxt);
  await page.fill('#nom-segment', 'Faux plat du test');
  await page.click('[data-creer]');
  verif('segment créé, 1 passage', (await texteToast(page)).includes('1 passage trouvé'));
  await page.waitForSelector('#bloc-segments-sortie .passage');
  const passageTxt = (await page.textContent('#bloc-segments-sortie .passage')).replace(/\s+/g, ' ');
  // 10 km à 30 km/h = 20 min
  verif('passage : 20:00, record perso, 200 W', /Faux plat du test.*20:0\d.*Record perso.*30,0 km\/h.*200 W/.test(passageTxt), passageTxt);
  // « Voir » sur un segment suivi : la sortie avec le segment en bleu
  await page.click('#bloc-segments-sortie [data-voir="s0"]');
  await page.waitForSelector('#bloc-segments-sortie .carte-segment .trait-segment', { state: 'attached' });
  verif('Voir sur un segment suivi : carte avec le segment', (await page.textContent('#bloc-segments-sortie [data-voir="s0"]')) === 'Fermer');
  await page.click('#bloc-segments-sortie [data-voir="s0"]');
  verif('segment suivi : aperçu refermé', !(await page.$('#bloc-segments-sortie .apercu-segment')));

  // Nouvelle sortie sur la même route, une semaine après, avec une pause de 10 min au km 15
  await page.setInputFiles('#champ-fichier', { name: 'col-bis.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ pauseS: 600, debutMs: Date.UTC(2025, 4, 17, 7), nom: 'Col du test bis' })) });
  verif('sortie bis importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  await attendre(page, async () => (await (await import('./js/segments.js')).lirePassages()).length === 2, null);
  await page.evaluate(() => document.querySelector('#bloc-segments-sortie').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  const yAvant = await page.evaluate(() => Math.round(window.scrollY));
  await page.click('#bloc-segments-sortie .passage');
  await page.waitForSelector('#page-segment .passage');
  verif('page du segment', (await page.textContent('#titre-page')) === 'Segment' && (await page.textContent('#page-segment .detail-nom')) === 'Faux plat du test');
  const statsSeg = (await page.textContent('#page-segment .stats')).replace(/\s+/g, '');
  verif('2 passages, record 20:00', /^Passages2Record20:0\d/.test(statsSeg), statsSeg);
  const parDate = await page.$$eval('#page-segment .passage', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  verif('par date : le plus récent d\'abord (17 mai, 30:00 avec la pause, 2e temps)', parDate[0].includes('17 mai 2025') && /30:0\d/.test(parDate[0]) && parDate[0].includes('2e temps'), JSON.stringify(parDate));
  await page.click('[data-segments="tri"] button[data-valeur="temps"]');
  verif('par temps : le record d\'abord', (await page.textContent('#page-segment .passage')).includes('Record perso'));
  await page.screenshot({ path: path.join(CAPTURES, 'segment.png'), fullPage: true });
  // Retour au détail de la sortie, puis Progrès : liste des segments
  await page.click('#btn-retour');
  await page.waitForSelector('#page-detail .detail-nom');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.waitForTimeout(400);
  const yApres = await page.evaluate(() => Math.round(window.scrollY));
  verif('retour du segment : la sortie reste au niveau des segments', yAvant > 100 && Math.abs(yApres - yAvant) <= 3, `avant ${yAvant}, après ${yApres}`);
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.click('#onglet-progres');
  await page.waitForSelector('#bloc-objectifs');
  verif('Progrès : plus de liste des segments, bloc objectifs en tête', !(await page.$('#bloc-segments')) && (await page.textContent('#bloc-objectifs')).includes('Aucun objectif'));
  // Objectifs : 5 000 km sur l'année, puis une FTP de 260 W sur le mois
  await page.click('[data-obj="ajouter"]');
  await page.selectOption('.objectif-form select[name="periode"]', 'annee');
  await page.fill('.objectif-form input[name="cible"]', '5000');
  await page.click('.objectif-form button[type="submit"]');
  await page.waitForSelector('#bloc-objectifs .objectif');
  const objTxt = (await page.textContent('#bloc-objectifs .objectif')).replace(/\s+/g, ' ');
  verif('objectif distance sur l\'année : libellé, chiffres, rythme', new RegExp(`Distance · ${new Date().getFullYear()}.*0 % ?de l'objectif.*Fait : 0 km.*Prévu à ce jour : [\\d ]+ km.*Objectif : 5 000 km.*reste .* km, soit .* km par semaine`).test(objTxt), objTxt);
  const arcs = await page.$eval('#bloc-objectifs .objectif', (o) => ({ rouge: !!o.querySelector('.anneau-fait'), bleu: o.querySelector('.anneau-attendu')?.getAttribute('stroke-dasharray') }));
  verif('anneau : pas d\'arc rouge (0 km), arc bleu = part de l\'année écoulée', !arcs.rouge && Number(arcs.bleu?.split(' ')[0]) > 0, JSON.stringify(arcs));
  await page.click('[data-obj="ajouter"]');
  await page.selectOption('.objectif-form select[name="type"]', 'ftp');
  verif('unité qui suit le type', (await page.textContent('.objectif-form .unite-objectif')) === 'W');
  await page.selectOption('.objectif-form select[name="periode"]', 'mois');
  await page.fill('.objectif-form input[name="cible"]', '260');
  await page.click('.objectif-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('#bloc-objectifs .objectif').length === 2);
  const ftpTxt = (await page.textContent('#bloc-objectifs .objectif:nth-of-type(2)')).replace(/\s+/g, ' ');
  verif('objectif FTP : cible et FTP réglée', /FTP · .*Objectif : 260 W.*FTP réglée : 2\d\d W/.test(ftpTxt), ftpTxt);
  await page.screenshot({ path: path.join(CAPTURES, 'objectifs.png') });
  // Modifier : 6 000 km ; gardé après réouverture de l'onglet
  await page.click('#bloc-objectifs .objectif [data-obj="modifier"]');
  await page.fill('.objectif-form input[name="cible"]', '6000');
  await page.click('.objectif-form button[type="submit"]');
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.click('#onglet-progres');
  await page.waitForSelector('#bloc-objectifs .objectif');
  verif('objectif modifié et gardé', (await page.textContent('#bloc-objectifs')).replace(/\s+/g, ' ').includes('Objectif : 6 000 km') &&(await page.$$('#bloc-objectifs .objectif')).length === 2, (await page.textContent('#bloc-objectifs')).replace(/\s+/g, ' '));
  page.once('dialog', (d) => d.accept());
  await page.click('#bloc-objectifs .objectif:nth-of-type(2) [data-obj="supprimer"]');
  await page.waitForFunction(() => document.querySelectorAll('#bloc-objectifs .objectif').length === 1);
  verif('objectif FTP supprimé', !(await page.textContent('#bloc-objectifs')).includes('260 W'));
  // On retire la sortie « bis » (et son passage) : la suite du test compte les sorties de l'archive
  await page.evaluate(async () => {
    const db = await (await import('./js/db.js')).ouvrirBase();
    const tous = await new Promise((r) => { const q = db.transaction('sorties').objectStore('sorties').getAll(); q.onsuccess = () => r(q.result); });
    const bis = tous.find((s) => s.nom === 'Col du test bis');
    const tx = db.transaction(['sorties', 'fichiers', 'reglages'], 'readwrite');
    tx.objectStore('sorties').delete(bis.id);
    tx.objectStore('fichiers').delete(bis.id);
    const r = tx.objectStore('reglages').get('passages');
    r.onsuccess = () => tx.objectStore('reglages').put(r.result.filter((p) => p.sortieId !== bis.id), 'passages');
    await new Promise((ok) => { tx.oncomplete = ok; });
  });

  // Segments automatiques : une sortie avec une montée (3 km à 6 %) et un sprint (900 W pendant 15 s)
  await page.setInputFiles('#champ-fichier', { name: 'montee.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ montee: true, lon: 5.7, vitesseKmh: 25, sprintW: 900, debutMs: Date.UTC(2025, 4, 18, 7), nom: 'Montée à voir' })) });
  verif('sortie avec montée importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  const idMontee = await page.evaluate(async () => (await (await import('./js/db.js')).toutesLesSorties()).find((x) => x.nom === 'Montée à voir').id);
  await attendre(page, async (id) => {
    const l = await (await import('./js/segments.js')).lireSegments();
    return l.some((g) => g.auto && g.type === 'Montée' && g.sortieOrigine === id) && l.some((g) => g.auto && g.type === 'Sprint' && g.sortieOrigine === id);
  }, idMontee);
  const autos = await page.evaluate(async (id) => (await (await import('./js/segments.js')).lireSegments()).filter((g) => g.sortieOrigine === id)
    .map((g) => ({ type: g.type, km: Math.round(g.distanceM / 100) / 10, pente: Math.round(g.penteMoyPct * 10) / 10 })), idMontee);
  verif('segments automatiques : la montée (≈ 3 km à 6 %) et le sprint (≥ 700 W), rien d\'autre', autos.length === 2
    && autos.some((a) => a.type === 'Montée' && Math.abs(a.km - 3) <= 0.4 && Math.abs(a.pente - 6) <= 0.6) && autos.some((a) => a.type === 'Sprint'), JSON.stringify(autos));
  verif('Col du test (1,2 %, 200 W) : aucun segment automatique', await page.evaluate(async () => !(await (await import('./js/segments.js')).lireSegments()).some((g) => g.auto && g.sortieOrigine === 'strava-222')));
  await attendre(page, async (id) => (await (await import('./js/segments.js')).lireSegments()).some((g) => g.sortieOrigine === id && g.nom === 'Montée du col du Test'), idMontee);
  verif('nom de la montée avec les lieux : col trouvé en haut (OpenStreetMap)', true);
  await page.goto(URL_APPLI + '#sortie=' + encodeURIComponent(idMontee));
  await ouvrirRepli(page, '#bloc-segments-sortie');
  await page.waitForSelector('#bloc-segments-sortie .passage-suivi');
  verif('segments : résumé avec le nombre de segments', /2 segments/.test(await page.textContent('#bloc-segments-sortie summary')), await page.textContent('#bloc-segments-sortie summary'));
  const suivis = (await page.textContent('#bloc-segments-sortie .passages')).replace(/\s+/g, ' ');
  verif('détail : montée et sprint suivis d\'office, plus rien à « Suivre »', suivis.includes('Montée du col du Test') && suivis.includes('Sprint') && !(await page.$('#bloc-segments-sortie .proposition')), suivis);
  verif('premier passage : pas de coupe', !(await page.$('#page-detail .coupe-pr')));
  // « Voir » sur la montée suivie : carte de la sortie avec le segment en bleu, puis 3D du segment seul
  await page.click('#bloc-segments-sortie [data-voir="s0"]');
  await page.waitForSelector('#bloc-segments-sortie .carte-segment .trait-segment', { state: 'attached' });
  const traits = await page.$$eval('#bloc-segments-sortie .carte-segment path.leaflet-interactive', (ps) => ps.map((p) => p.getAttribute('stroke')));
  verif('carte : la sortie en orange, le segment en bleu par-dessus', traits.includes('#1e88e5') && traits.some((c) => c && c.startsWith('#e')), JSON.stringify(traits));
  const largeurs = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { seg: r('#bloc-segments-sortie .trait-segment').height, carte: r('#bloc-segments-sortie .carte-segment').height };
  });
  // 3 km sur 25 km de sortie toute droite vers le nord : le segment fait ~1/8 de la hauteur de la carte
  verif('carte cadrée sur toute la sortie (segment ≈ 1/8 de la hauteur)', largeurs.seg > 10 && largeurs.seg < largeurs.carte * 0.25, JSON.stringify(largeurs));
  verif('bouton Fermer', (await page.textContent('#bloc-segments-sortie [data-voir="s0"]')) === 'Fermer');
  await page.locator('#bloc-segments-sortie .apercu-segment').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, 'segment-voir-carte.png') });
  await page.click('#bloc-segments-sortie [data-segments="vue-segment"] button[data-valeur="3d"]');
  await page.waitForTimeout(700);
  verif('3D du segment affichée, carte cachée', await page.isVisible('#bloc-segments-sortie .vue3d-segment canvas') && !(await page.isVisible('#bloc-segments-sortie .carte-segment')));
  const pentes = await page.$eval('#bloc-segments-sortie .vue3d-segment canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 60 && d[i + 1] < 160 && d[i + 2] < 80) n++;
    return n;
  });
  verif('3D : ruban en couleurs de montée (orange, 6 %)', pentes > 200, String(pentes));
  await page.locator('#bloc-segments-sortie .apercu-segment').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(CAPTURES, 'segment-voir-3d.png') });
  await page.click('#bloc-segments-sortie [data-voir="s0"]');
  verif('Fermer : aperçu retiré', !(await page.$('#bloc-segments-sortie .apercu-segment')));

  // Même route une semaine après, plus vite (30 km/h) : 3 records perso -> coupe « 3 » : la montée, le sprint
  // de la 1re sortie, et son propre sprint (plus loin), où la 1re sortie était passée moins vite
  await page.setInputFiles('#champ-fichier', { name: 'montee-bis.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ montee: true, lon: 5.7, vitesseKmh: 30, sprintW: 900, debutMs: Date.UTC(2025, 4, 25, 7), nom: 'Montée plus vite' })) });
  verif('deuxième sortie importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  const idBis = await page.evaluate(async () => (await (await import('./js/db.js')).toutesLesSorties()).find((x) => x.nom === 'Montée plus vite').id);
  await attendre(page, async (id) => ((await (await import('./js/segments.js')).recordsDesSorties()).get(id) ?? 0) >= 3, idBis);
  const segBis = await page.evaluate(async (ids) => {
    const l = await (await import('./js/segments.js')).lireSegments();
    return { montees: l.filter((g) => g.type === 'Montée' && ids.includes(g.sortieOrigine)).length, sprintsBis: l.filter((g) => g.type === 'Sprint' && g.sortieOrigine === ids[1]).length };
  }, [idMontee, idBis]);
  verif('pas de doublon : une seule montée ; le sprint de la 2e sortie (ailleurs) devient un segment', segBis.montees === 1 && segBis.sprintsBis === 1, JSON.stringify(segBis));
  await page.goto(URL_APPLI);
  await page.waitForSelector('#accueil:not([hidden]) a.sortie');
  await page.waitForSelector(`a.sortie[href="#sortie=${encodeURIComponent(idBis)}"] .coupe-pr`, { timeout: 10000 });
  const coupe = await page.textContent(`a.sortie[href="#sortie=${encodeURIComponent(idBis)}"] .coupe-pr`);
  verif('liste : coupe en or avec 3 records', coupe.replace(/\s+/g, '') === '🏆3', coupe);
  verif('liste : pas de coupe sur la première sortie', !(await page.$(`a.sortie[href="#sortie=${encodeURIComponent(idMontee)}"] .coupe-pr`)));
  await page.locator(`a.sortie[href="#sortie=${encodeURIComponent(idBis)}"]`).screenshot({ path: path.join(CAPTURES, 'carte-records.png') });
  await page.click(`a.sortie[href="#sortie=${encodeURIComponent(idBis)}"]`);
  await page.waitForSelector('#page-detail .detail-nom .coupe-pr');
  verif('détail : coupe 3 à côté du nom', (await page.textContent('#page-detail .detail-nom .coupe-pr')).replace(/\s+/g, '') === '🏆3');
  await ouvrirRepli(page, '#bloc-segments-sortie');
  await page.waitForSelector('#bloc-segments-sortie .passage-suivi');
  verif('segments : résumé avec les records (🏆 3)', /🏆 3 records/.test(await page.textContent('#bloc-segments-sortie summary')), await page.textContent('#bloc-segments-sortie summary'));
  verif('détail : record perso sur la montée', /Montée du col du Test.*Record perso/.test((await page.textContent('#bloc-segments-sortie')).replace(/\s+/g, ' ')));
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURES, 'detail-records.png') });

  // On retire ces deux sorties, leurs segments et leurs passages (la suite compte les sorties de l'archive)
  await page.evaluate(async (ids) => {
    const db = await import('./js/db.js');
    const base = await db.ouvrirBase();
    const tx = base.transaction(['sorties', 'fichiers'], 'readwrite');
    for (const id of ids) { tx.objectStore('sorties').delete(id); tx.objectStore('fichiers').delete(id); }
    await new Promise((ok) => { tx.oncomplete = ok; });
    await db.ecrireReglage('segments', ((await db.lireReglage('segments')) ?? []).filter((g) => !ids.includes(g.sortieOrigine)));
    await db.ecrireReglage('passages', ((await db.lireReglage('passages')) ?? []).filter((p) => !ids.includes(p.sortieId)));
  }, [idMontee, idBis]);

  await page.click('#btn-retour');
  await page.waitForSelector('#onglet-sorties', { state: 'visible' });
  await page.click('#onglet-sorties');
  await page.click('a.sortie:has-text("Col du test")');
  await page.waitForSelector('#page-detail .courbe');
  // Export GPX de la sortie : 3 601 points, heures, puissance, FC, cadence
  const [dlSortie] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="gpx"]')]);
  const cheminSortie = path.join(CAPTURES, 'sortie-export.gpx');
  await dlSortie.saveAs(cheminSortie);
  const gpxSortie = fs.readFileSync(cheminSortie, 'utf8');
  verif('export : message', (await texteToast(page)).includes('enregistré dans Téléchargements'));
  const { lireGpx } = await import('../js/trace.js');
  let relu = null;
  try { relu = lireGpx(gpxSortie); } catch (e) { relu = { erreur: e.message }; }
  verif('export GPX de la sortie : points, heures, capteurs', /^2025-05-10-col-du-test\.gpx$/.test(dlSortie.suggestedFilename())
    && (gpxSortie.match(/<trkpt /g) || []).length === 3601 && gpxSortie.includes('<power>200</power>') && gpxSortie.includes('<gpxtpx:hr>140</gpxtpx:hr>')
    && gpxSortie.includes('<gpxtpx:cad>90</gpxtpx:cad>') && gpxSortie.includes('<type>cycling</type>'), dlSortie.suggestedFilename());
  const r0 = relu.records?.[0] ?? {};
  verif('export GPX relu par l\'appli : 3 601 points, départ 9 h, 200 W, 140 bpm', relu.records?.length === 3601 && r0.horodatage?.getTime() === Date.UTC(2025, 4, 10, 7)
    && r0.puissanceW === 200 && r0.fc === 140 && relu.sport === 2, JSON.stringify({ n: relu.records?.length, r0, sport: relu.sport, err: relu.erreur }));
  // Puissances par durée (200 W constants pendant 1 h) et FTP estimée après la sortie
  const puiss = (await page.textContent('#bloc-puissances')).replace(/\s+/g, ' ');
  verif('détail : puissances 5 s à 1 h (200 W), colonne record, courbe', /5 s 200 W.*1 min 200 W.*5 min 200 W.*20 min 200 W.*1 h 200 W/.test(puiss)
    && puiss.includes('Cette sortie') && puiss.includes('Record') && !!(await page.$('#bloc-puissances .courbe-puissance path.ligne-recent')), puiss);
  verif('détail : FTP estimée après la sortie (≥ 95 % de 200 W = 190 W)', /FTP estimée après cette sortie : (19\d|2\d\d) W/.test(puiss), puiss);
  await page.locator('#bloc-puissances').screenshot({ path: path.join(CAPTURES, 'detail-puissances.png') });

  // Image à partager : 4 formats, photo placée par son heure (EXIF), enregistrement en JPEG
  await page.click('#btn-image-sortie');
  await page.waitForSelector('#bloc-image canvas.image-sortie', { timeout: 15000 });
  const taille = async () => page.$eval('#bloc-image canvas.image-sortie', (c) => [c.width, c.height]);
  verif('image : portrait 1080×1350 par défaut', JSON.stringify(await taille()) === '[1080,1350]', JSON.stringify(await taille()));
  const couleursImage = async () => page.$eval('#bloc-image canvas.image-sortie', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let trace = 0; let accent = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 230 && d[i + 1] > 80 && d[i + 1] < 130 && d[i + 2] < 50) trace++; // orange #ff6a13
      if (d[i] > 180 && d[i] < 215 && d[i + 1] > 225 && d[i + 2] < 80) accent++; // vert-jaune #c8f031 (logo)
    }
    return { trace, accent };
  });
  const coul = await couleursImage();
  verif('image : tracé orange sur la carte et logo de l\'appli', coul.trace > 500 && coul.accent > 500, JSON.stringify(coul));
  for (const [f, dim] of [['story', '[1080,1920]'], ['carre', '[1080,1080]'], ['paysage', '[1200,630]']]) {
    await page.click(`[data-segments="format-image"] button[data-valeur="${f}"]`);
    await page.waitForFunction((d) => { const c = document.querySelector('#bloc-image canvas.image-sortie'); return c && JSON.stringify([c.width, c.height]) === d; }, dim, { timeout: 15000 });
    verif(`image : format ${f} ${dim}`, true);
    if (f === 'story') await page.locator('#bloc-image canvas.image-sortie').screenshot({ path: path.join(CAPTURES, 'image-story.png') });
    if (f === 'paysage') await page.locator('#bloc-image canvas.image-sortie').screenshot({ path: path.join(CAPTURES, 'image-paysage.png') });
  }
  await page.click('[data-segments="format-image"] button[data-valeur="portrait"]');
  // Photo : vrai JPEG fabriqué dans la page, avec une date EXIF « 2025:05:10 09:30:00 » (heure de Paris)
  // -> 30 min après le départ (9 h) à 30 km/h : km 15
  const jpeg = Buffer.from(await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 800, 600); g.addColorStop(0, '#3a7bd5'); g.addColorStop(1, '#00d2ff');
    x.fillStyle = g; x.fillRect(0, 0, 800, 600); x.fillStyle = '#fff'; x.font = '80px sans-serif'; x.fillText('PHOTO', 260, 330);
    const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    return [...new Uint8Array(await b.arrayBuffer())];
  }));
  const exif = (() => {
    const t = []; const u16 = (v) => t.push(v & 255, v >> 8); const u32 = (v) => t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24);
    t.push(0x49, 0x49); u16(42); u32(8);
    u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0);
    u16(1); u16(0x9003); u16(2); u32(20); u32(44); u32(0);
    for (const ch of '2025:05:10 09:30:00\0') t.push(ch.charCodeAt(0));
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
    return [0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1];
  })();
  const photo = Buffer.concat([jpeg.subarray(0, 2), Buffer.from(exif), jpeg.subarray(2)]);
  await page.setInputFiles('#photos-image', { name: 'photo-col.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.waitForSelector('#bloc-image .photo-vignette');
  const vignette = (await page.textContent('#bloc-image .photo-vignette')).replace(/\s+/g, ' ');
  verif('photo placée par son heure : km 15', vignette.includes('1. km 15,0'), vignette);
  await page.waitForFunction(() => !document.querySelector('#bloc-image .apercu-image.en-cours'), null, { timeout: 15000 });
  const bleuPhoto = await page.$eval('#bloc-image canvas.image-sortie', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 2] > 200 && d[i + 1] > 110) n++;
    return n;
  });
  verif('image : la photo est dans l\'image', bleuPhoto > 50000, String(bleuPhoto));
  await page.locator('#bloc-image canvas.image-sortie').screenshot({ path: path.join(CAPTURES, 'image-portrait.png') });
  const [dlImage] = await Promise.all([page.waitForEvent('download'), page.click('[data-image="enregistrer"]')]);
  const cheminImage = path.join(CAPTURES, 'image-sortie.jpg');
  await dlImage.saveAs(cheminImage);
  const octetsImage = fs.readFileSync(cheminImage);
  verif('image enregistrée en JPEG', dlImage.suggestedFilename() === '2025-05-10-col-du-test-portrait.jpg' && octetsImage[0] === 0xff && octetsImage[1] === 0xd8 && octetsImage.length > 30000,
    `${dlImage.suggestedFilename()} ${octetsImage.length}`);
  await texteToast(page);
  await page.click('#bloc-image .photo-retirer');
  verif('photo retirée', !(await page.$('#bloc-image .photo-vignette')));

  // Retour : la liste revient à la même place
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  verif('retour à la liste', !page.url().includes('#sortie'), page.url());

  // Sortie sans trace : pas de carte ni de courbes
  await page.click('a.sortie:has-text("Home trainer sans capteur")');
  await page.waitForSelector('#page-detail .detail-nom');
  verif('sans trace : ni carte ni courbes', !(await page.$('#carte-parcours')) && !(await page.$('.courbe')));
  await page.click('#btn-retour');

  // 2 ter. Réglages : FTP 250 W -> TSS de « Col du test » = 3600 × 0,8² / 36 = 64
  await page.click('#onglet-profil');
  await page.waitForSelector('#champ-ftp');
  verif('FTP par défaut 236 W', (await page.inputValue('#champ-ftp')) === '236');
  verif('FC max : la plus haute relevée', (await page.getAttribute('#champ-fcmax', 'placeholder')) === '150');
  await page.click('#btn-estimer');
  await page.waitForFunction(() => !document.getElementById('estimation').textContent.includes('Calcul'));
  verif('estimation sans sortie récente', (await page.textContent('#estimation')).includes('Aucune sortie avec capteur de puissance'));
  await page.fill('#champ-ftp', '250');
  verif('zones recalculées en direct', (await page.textContent('#zones-reglages')).includes('Z4 Seuil226–263 W'), await page.textContent('#zones-reglages'));
  await page.screenshot({ path: path.join(CAPTURES, 'reglages.png'), fullPage: true });
  await page.click('#btn-enregistrer');
  verif('réglages enregistrés', (await texteToast(page)).includes('FTP 250 W'));
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');
  const col = (await page.textContent('a.sortie:has-text("Col du test")')).replace(/\s+/g, ' ');
  verif('TSS recalculé avec FTP 250 W', col.includes('TSS 64'), col);
  // Remise à 236 W pour la suite
  await page.evaluate(async () => (await import('./js/profil.js')).ecrireProfil({ ftpW: 236 }));

  // 2 quater. Progrès : bilans, forme, records
  await page.click('#onglet-progres');
  await page.waitForSelector('#bloc-bilans');
  verif('onglet Progrès actif', (await page.getAttribute('#onglet-progres', 'aria-current')) === 'page' && (await page.textContent('#titre-page')) === 'Progrès');
  await page.click('[data-segments="type"] button[data-valeur="annee"]');
  const annees = await page.$$eval('.barre-col', (els) => els.map((e) => e.getAttribute('aria-label')));
  verif('années 2025 et 2026', annees.length === 2 && annees[0].startsWith('2025') && annees[1].startsWith('Cette année'), JSON.stringify(annees));
  await page.click('.barre-col[data-i="0"]');
  const bilan2025 = (await page.textContent('#bloc-bilans .stats')).replace(/\s+/g, '');
  // 30 + 30 + 1,8 + 0,1 + 25 + 5,2 km ; 3600 + 3600 + 600 + 60 + 3540 + 2700 + 4200 s ; 400 + 180 + 40 m
  verif('bilan 2025 : 92,1 km, 5 h 05, 620 m, 7 sorties', bilan2025 === 'Distance92,1kmTemps5h05Dénivelé620mSorties7', bilan2025);
  await page.click('[data-segments="metrique"] button[data-valeur="denivele"]');
  verif('barre 2025 toujours choisie après changement de mesure', (await page.getAttribute('.barre-col[data-i="0"]', 'aria-pressed')) === 'true');
  verif('forme et fatigue affichées', !!(await page.$('#forme-graph .ligne-forme')) && (await page.textContent('#bloc-forme')).includes('Fraîcheur'));
  await page.waitForFunction(() => !document.getElementById('records-progression'), null, { timeout: 30000 });
  const recordsTxt = (await page.textContent('#bloc-records table')).replace(/\s+/g, ' ');
  for (const m of ['5 s 250 W2,6 W/kg · 20 avr. 2025', '20 min 200 W2,0 W/kg · 10 mai 2025', '1 h 200 W2,0 W/kg · 10 mai 2025']) verif(`record « ${m} »`, recordsTxt.includes(m), recordsTxt);
  verif('courbe de puissance', !!(await page.$('.ligne-record')));
  await page.click('[data-segments="type"] button[data-valeur="semaine"]');
  await page.screenshot({ path: path.join(CAPTURES, 'progres-sombre.png'), fullPage: true });
  verif('Progrès : pas de défilement horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  // Lien d'un record vers sa sortie, puis retour sur Progrès
  await page.click('#bloc-records a >> nth=0');
  await page.waitForSelector('#page-detail .detail-nom');
  await page.click('#btn-retour');
  await page.waitForSelector('#bloc-bilans');
  verif('retour du détail vers Progrès', page.url().endsWith('#progres'), page.url());

  // Forme et fatigue sur une année civile
  const plages = await page.$$eval('[data-segments="plage"] button', (els) => els.map((e) => e.textContent));
  verif('choix des plages : 3 mois, 1 an, années, Tout', JSON.stringify(plages) === JSON.stringify(['3 mois', '1 an', '2026', '2025', 'Tout']), JSON.stringify(plages));
  await page.click('[data-segments="plage"] button[data-valeur="a2025"]');
  const axeForme = (await page.$$eval('#bloc-forme .courbes-x span', (els) => els.map((e) => e.textContent).join(' '))).replace(/\s+/g, ' ');
  verif('année 2025 : du 2 févr. (1re sortie) au 31 déc.', axeForme === '2 févr. 2025 31 déc. 2025', axeForme);
  verif('pic de forme de la période', (await page.textContent('.pic-forme')).includes('forme maxi'));
  await page.screenshot({ path: path.join(CAPTURES, 'forme-2025.png') });

  // Poids et W/kg
  await page.click('#onglet-profil');
  await page.waitForSelector('#champ-poids');
  verif('poids par défaut 98 kg, FTP 2,4 W/kg', (await page.inputValue('#champ-poids')) === '98' && (await page.textContent('#ftp-wkg')) === 'Soit 2,4 W/kg.', await page.textContent('#ftp-wkg'));
  await page.fill('#champ-poids', '95');
  verif('W/kg recalculé en direct (236 / 95)', (await page.textContent('#ftp-wkg')) === 'Soit 2,5 W/kg.', await page.textContent('#ftp-wkg'));
  await page.click('#btn-enregistrer');
  verif('poids enregistré', (await texteToast(page)).includes('95 kg'));
  await page.evaluate(async () => (await import('./js/profil.js')).ecrireProfil({ poidsKg: 98 }));

  // Vélos : ajout, vélo par défaut, attribution du matériel Strava
  await page.click('#onglet-sorties');
  await page.click('#onglet-profil');
  await page.waitForSelector('#bloc-velos [data-action="ajouter"]');
  await page.click('#bloc-velos [data-action="ajouter"]');
  await page.fill('.velo-form input[name="nom"]', 'Canyon Endurace');
  await page.fill('.velo-form input[name="kmAvant"]', '1000');
  await page.check('.velo-form input[name="parDefaut"]');
  await page.click('.velo-form button[type="submit"]');
  verif('vélo ajouté', (await texteToast(page)).includes('Canyon Endurace'));
  await page.click('#bloc-velos [data-action="ajouter"]');
  await page.fill('.velo-form input[name="nom"]', 'Home trainer');
  await page.click('.velo-form button[type="submit"]');
  await texteToast(page);
  const lots = await page.$$eval('#bloc-velos .lot-texte', (els) => els.map((e) => e.textContent.trim()));
  verif('matériel Strava des sorties vélo proposé (pas les chaussures)', JSON.stringify(lots.slice(0, 2)) === JSON.stringify(['« Canyon » : 2 sorties', '« Home trainer » : 1 sortie']) && !lots.some((l) => l.includes('Chaussures')), JSON.stringify(lots));
  const choisir = async (materiel, nomVelo) => {
    const lot = page.locator(`#bloc-velos .lot[data-materiel="${materiel}"]`);
    await lot.locator('select').selectOption({ label: nomVelo });
    await lot.locator('[data-action="lot-materiel"]').click();
    return texteToast(page);
  };
  verif('Canyon : 2 sorties attribuées', (await choisir('Canyon', 'Canyon Endurace')).includes('2 sorties attribuées'));
  await choisir('Home trainer', 'Home trainer');
  const kmVelos = await page.$$eval('#bloc-velos .velo', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  // 1000 km d'avant + 30 + 30 km ; home trainer : 25 km
  verif('kilométrage du Canyon : 1 060 km, 2 sorties, par défaut', kmVelos[0].includes('Canyon Endurace par défaut') && kmVelos[0].includes('1 060 km · 2 sorties') && kmVelos[0].includes("dont 1 000 km avant l'appli"), kmVelos[0]);
  verif('kilométrage du home trainer : 25 km', kmVelos[1].includes('25 km · 1 sortie'), kmVelos[1]);
  await page.screenshot({ path: path.join(CAPTURES, 'velos.png'), fullPage: true });
  // Changement de vélo dans le détail d'une sortie
  await page.click('#onglet-sorties');
  await page.click('a.sortie:has-text("Col du test")');
  await page.waitForFunction(() => document.querySelector('#page-detail .detail-nom')?.textContent.startsWith('Col du test') && !!document.querySelector('#page-detail #choix-velo') && !document.documentElement.dataset.transition);
  verif('détail : vélo de la sortie', (await page.$eval('#choix-velo', (s) => s.selectedOptions[0].textContent)) === 'Canyon Endurace');
  await page.selectOption('#choix-velo', { label: 'Home trainer' });
  await page.waitForTimeout(200);
  await page.click('#btn-retour');
  await page.click('#onglet-profil');
  // la page Profil se redessine après coup : on attend le nouveau kilométrage (5 s au plus)
  await page.waitForFunction(() => document.querySelector('#bloc-velos .velo-km')?.textContent.includes('1 030'), null, { timeout: 5000 }).catch(() => {});
  const km2 =await page.$$eval('#bloc-velos .velo-km', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  verif('après changement : Canyon 1 030 km, home trainer 55 km', km2[0].startsWith('1 030 km · 1 sortie') && km2[1].startsWith('55 km · 2 sorties'), JSON.stringify(km2));

  // 2 quinquies. Sauvegarde puis restauration sur un téléphone « vide »
  await page.click('#onglet-profil');
  await page.waitForSelector('#btn-sauvegarder');
  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('#btn-sauvegarder')]);
  const cheminZip = path.join(CAPTURES, 'sauvegarde-test.zip');
  await telechargement.saveAs(cheminZip);
  verif('nom du fichier de sauvegarde', /^mes-sorties-sauvegarde-\d{4}-\d{2}-\d{2}\.zip$/.test(telechargement.suggestedFilename()), telechargement.suggestedFilename());
  const sauvegarde = await JSZip.loadAsync(fs.readFileSync(cheminZip));
  const index = JSON.parse(await sauvegarde.file('sauvegarde-mes-sorties.json').async('string'));
  verif('sauvegarde : 7 sorties, 3 fichiers, FTP', index.sorties.length === 7 && Object.keys(sauvegarde.files).filter((n) => n.startsWith('fichiers/') && !n.endsWith('/')).length === 3 && index.reglages.ftpW === 236,
    `${index.sorties.length} sorties, ${Object.keys(sauvegarde.files)}`);
  verif('date de dernière sauvegarde', (await page.textContent('#sauvegarde-date')).includes("à l'instant"));
  await page.screenshot({ path: path.join(CAPTURES, 'profil.png'), fullPage: true });
  await page.evaluate(async () => {
    const req = indexedDB.open('mes-sorties', 1);
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tx = db.transaction(['sorties', 'fichiers'], 'readwrite');
    tx.objectStore('sorties').clear(); tx.objectStore('fichiers').clear();
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await page.setInputFiles('#champ-fichier', cheminZip);
  const tr = await texteToast(page);
  verif('restauration : 7 nouvelles sorties', tr.includes('7 nouvelles sorties') && !tr.includes('illisible'), tr);
  await page.setInputFiles('#champ-fichier', cheminZip);
  verif('restauration en double : rien de nouveau', (await texteToast(page)).includes('7 déjà connues'));
  await page.click('#onglet-sorties');
  await page.click('a.sortie:has-text("Col du test")');
  await page.waitForSelector('#page-detail .courbe');
  verif('détail après restauration (fichier GPX repris)', (await page.$$('.courbe')).length === 5);
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');

  // Lien direct vers un détail (appli rouverte sur la page)
  await page.goto(URL_APPLI + '#sortie=strava-333');
  await page.waitForSelector('#page-detail .courbe');
  verif('ouverture directe du détail', (await page.textContent('.detail-nom')) === 'Footing');
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');

  // Détail en thème clair
  const pageClaire = await ctx.newPage();
  await pageClaire.emulateMedia({ colorScheme: 'light' });
  await pageClaire.goto(URL_APPLI + '#sortie=1234-1748764800000');
  await pageClaire.waitForSelector('#page-detail .courbe');
  await pageClaire.waitForTimeout(300);
  await pageClaire.screenshot({ path: path.join(CAPTURES, 'detail-2-clair.png'), fullPage: true });
  await pageClaire.close();
  verif('pas de défilement horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // 3. Même archive une seconde fois : rien de nouveau
  await page.setInputFiles('#champ-fichier', { name: 'export_12345678.zip', mimeType: 'application/zip', buffer: zipBytes });
  const t2 = await texteToast(page);
  verif('réimport : aucune nouvelle, 7 déjà connues', t2.includes('Aucune nouvelle sortie') && t2.includes('7 déjà connues'), t2);

  // 4. Tri par activité
  // Menu déroulant « Activité » : « Vélo (4) » -> « Vélo 4 », choisi marqué d'une étoile
  const filtres = async () => page.$$eval('#menu-activite [data-cle]', (els) => els.map((e) => `${e.getAttribute('aria-label').replace(/ \((\d+)\)$/, ' $1')}${e.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
  const choisirActivite = async (nom) => {
    await page.click('#btn-activite');
    await page.waitForSelector('#menu-activite.ouvert');
    await page.click(`#menu-activite [aria-label^="${nom} ("]`);
  };
  const f1 = await filtres();
  verif('boutons de tri', JSON.stringify(f1) === JSON.stringify(['Tout 7*', 'Vélo 4', 'Course à pied 1', 'Marche 1', 'Musculation 1']), JSON.stringify(f1));
  await choisirActivite('Vélo');
  await page.waitForFunction(() => document.querySelectorAll('.sortie').length === 4);
  const noms = await page.$$eval('.sortie-nom', (els) => els.map((e) => e.textContent));
  verif('Vélo : 4 sorties', JSON.stringify(noms) === JSON.stringify(['Sortie du matin', 'Col du test', 'Home trainer sans capteur', 'Fichier vide']), JSON.stringify(noms));
  const cumuls = await page.$$eval('.mois-cumul', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  verif('totaux du mois de mars sans la musculation', cumuls[2] === '1 sortie · 25,0 km · 59 min · 0 m D+', JSON.stringify(cumuls));
  verif('totaux de février sans la marche', cumuls[3] === '1 sortie · 0,1 km · 1 min · 0 m D+', JSON.stringify(cumuls));
  await page.screenshot({ path: path.join(CAPTURES, 'strava-2-tri-velo.png') });
  // Grande carte de la liste : titre dessus, tracé d'une seule couleur (les couleurs sont dans le détail : plus léger)
  const cartePuissance = page.locator('.sortie-grande', { hasText: 'Sortie du matin' });
  verif('grande carte : titre sur la carte, pas de puces ni de couleurs dans la liste', (await cartePuissance.locator('.sortie-carte .sortie-nom').count()) === 1
    && (await page.locator('#liste .puce-trace').count()) === 0 && (await page.locator('.sortie-grande .apercu-morceau').count()) === 0
    && (await cartePuissance.locator('.apercu-trace').count()) === 1);
  await page.screenshot({ path: path.join(CAPTURES, 'liste-grande-carte.png') });
  // Détail : mêmes puces sous la carte, légende des zones de puissance
  await cartePuissance.locator('.sortie-nom').click();
  await page.waitForSelector('#couleurs-carte .puce-trace');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  verif('détail : puces sous la carte, Puissance choisie, légende des 7 zones', (await page.locator('#couleurs-carte .puce-trace').count()) === 6
    && (await page.textContent('#couleurs-carte .puce-trace.on')) === 'Puissance' && (await page.locator('#couleurs-carte .legende-trace.zones span').count()) === 7);
  const nbLignes = await page.locator('#carte-parcours path.leaflet-interactive').count();
  verif('détail : tracé en morceaux sur la carte Leaflet', nbLignes > 2, String(nbLignes));
  await page.screenshot({ path: path.join(CAPTURES, 'detail-trace-colore.png') });
  await page.click('#couleurs-carte .puce-trace[data-mode="uni"]');
  verif('détail : Uni = pas de légende, tracé d\'une couleur', (await page.locator('#couleurs-carte .legende-trace').count()) === 0 && (await page.locator('#carte-parcours path.leaflet-interactive').count()) < nbLignes);
  await page.click('#couleurs-carte .puce-trace[data-mode="puissance"]');
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  // Boutons ronds de l'accueil : icône du vélo choisie, nom complet pour le lecteur d'écran, pastille sur ⟳
  verif('bouton Activité : icône du vélo, libellé « Vélo (4) »', (await page.innerHTML('#icone-activite')).includes('<circle cx="6" cy="16"')
    && (await page.getAttribute('#btn-activite', 'aria-label')) === "Type d'activité : Vélo (4)");
  verif('menu Activité : seulement des icônes (ni nombre ni rond de sélection visibles)', await page.evaluate(() => {
    const p = document.getElementById('menu-activite');
    return [...p.querySelectorAll('[data-cle]')].every((b) => b.querySelector('svg') && b.textContent.trim() === '') && !p.querySelector('input');
  }));
  verif('bouton Synchro : pastille d\'état dans le bouton ⟳', !!(await page.$('#btn-menu-synchro .pastille')) && (await page.$$('.outils')).length === 0);
  await page.click('#btn-activite');
  await page.waitForSelector('#menu-activite.ouvert');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, 'menu-activite.png'), clip: { x: 0, y: 0, width: 390, height: 520 } });
  await page.keyboard.press('Escape');
  await page.locator('header.barre').screenshot({ path: path.join(CAPTURES, 'accueil-boutons.png') });
  await page.reload();
  await page.waitForSelector('#menu-activite [data-cle]:nth-child(2)', { state: 'attached' });
  verif('tri gardé après réouverture', (await filtres())[1] === 'Vélo 4*' && (await page.$$('.sortie')).length === 4, JSON.stringify(await filtres()));
  await choisirActivite('Musculation');
  await page.waitForFunction(() => document.querySelectorAll('.sortie').length === 1);
  verif('Musculation : la séance', (await page.textContent('.sortie-nom')) === 'Séance haut du corps');
  await page.screenshot({ path: path.join(CAPTURES, 'strava-3-tri-musculation.png') });
  verif('pas de défilement horizontal avec les boutons', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // Mannequin : choix des muscles de la séance de musculation
  await page.click('a.sortie');
  await page.waitForSelector('#bloc-muscles .mannequin.interactif');
  verif('mannequin : menu ouvert d\'office (musculation sans muscles), résumé « À choisir »', await page.$eval('#bloc-muscles details', (d) => d.open)
    && (await page.textContent('#bloc-muscles summary')).includes('À choisir'));
  verif('mannequin : face et dos', (await page.$$('#bloc-muscles svg.mq')).length === 2);
  const zoneMq = (m) => `#bloc-muscles .mz[data-m="${m}"]`;
  await page.dispatchEvent(`${zoneMq('pecs')} path`, 'click');
  verif('1er toucher : pectoraux principal (rouge)', (await page.getAttribute(zoneMq('pecs'), 'data-etat')) === 'p');
  const rouge = await page.$eval(`${zoneMq('pecs')} path`, (p) => getComputedStyle(p).fill);
  verif('pectoraux en rouge #d9453d', rouge === 'rgb(217, 69, 61)', rouge);
  await page.dispatchEvent(`${zoneMq('triceps')} path`, 'click');
  await page.dispatchEvent(`${zoneMq('triceps')} path`, 'click');
  const orange = await page.$eval(`${zoneMq('triceps')} path`, (p) => getComputedStyle(p).fill);
  verif('2 touchers : triceps secondaire (orange #f2b035)', (await page.getAttribute(zoneMq('triceps'), 'data-etat')) === 's' && orange === 'rgb(242, 176, 53)', orange);
  await page.dispatchEvent(`${zoneMq('epaules')} path`, 'click');
  verif('épaules : même zone sur la face et sur le dos', (await page.$$eval(zoneMq('epaules'), (g) => g.map((x) => x.dataset.etat))).join() === 'p,p');
  await page.dispatchEvent(`${zoneMq('epaules')} >> nth=0 >> path >> nth=0`, 'click');
  await page.dispatchEvent(`${zoneMq('epaules')} >> nth=0 >> path >> nth=0`, 'click');
  verif('3e toucher : épaules effacées', (await page.getAttribute(zoneMq('epaules') + ' >> nth=0', 'data-etat')) === null);
  const resume = (await page.textContent('#bloc-muscles .mq-resume')).replace(/\s+/g, ' ');
  verif('résumé écrit sous le mannequin', resume === 'Principaux : Pectoraux · Secondaires : Triceps', resume);
  verif('résumé du menu : 2 zones', (await page.textContent('#bloc-muscles summary')).includes('2 zones'));
  await page.locator('#bloc-muscles').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.locator('#bloc-muscles').screenshot({ path: path.join(CAPTURES, 'mannequin.png') });
  await page.click('#btn-retour');
  await page.waitForSelector('a.sortie .sortie-muscles .mannequin.mini');
  verif('liste : petit mannequin sur la carte de la séance', (await page.getAttribute('a.sortie .sortie-muscles', 'title')) === 'Principaux : Pectoraux · Secondaires : Triceps');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.waitForTimeout(400);
  await page.locator('a.sortie').first().screenshot({ path: path.join(CAPTURES, 'mannequin-liste.png') });
  await page.reload();
  await page.waitForSelector('a.sortie .sortie-muscles');
  await page.click('a.sortie');
  verif('menu replié quand des muscles sont déjà choisis, résumé « 2 zones »', await page.waitForFunction(() => document.querySelector('#bloc-muscles details') && !document.querySelector('#bloc-muscles details').open
    && document.querySelector('#bloc-muscles summary').textContent.includes('2 zones')).then(() => true));
  await ouvrirRepli(page, '#bloc-muscles');
  verif('muscles gardés après réouverture', (await page.getAttribute('#bloc-muscles .mz[data-m="pecs"]', 'data-etat')) === 'p'
    && (await page.getAttribute('#bloc-muscles .mz[data-m="triceps"]', 'data-etat')) === 's');
  await page.click('#btn-retour');
  await page.waitForSelector('a.sortie');

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
  await page.waitForSelector('#menu-activite [data-cle]:nth-child(2)', { state: 'attached' });
  verif('ancienne version : rangée dans Entraînement', (await filtres()).includes('Entraînement 1'), JSON.stringify(await filtres()));
  await page.setInputFiles('#champ-fichier', { name: 'export_12345678.zip', mimeType: 'application/zip', buffer: zipBytes });
  verif('réimport sans doublon', (await texteToast(page)).includes('Aucune nouvelle sortie'));
  const f2 = await filtres();
  verif('réimport : remise dans Musculation', f2.includes('Musculation 1') && !f2.some((f) => f.startsWith('Entraînement')), JSON.stringify(f2));
  await choisirActivite('Tout');

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
  const veloAuto = await page.evaluate(async () => {
    const [s] = await (await import('./js/db.js')).toutesLesSorties();
    const velos = await (await import('./js/profil.js')).lireVelos();
    return velos.find((v) => v.id === s.veloId)?.nom ?? null;
  });
  verif('nouvelle sortie vélo : vélo par défaut', veloAuto === 'Canyon Endurace', String(veloAuto));

  // 7. Hors ligne : la liste et le détail (trace, courbes) restent disponibles
  await attendre(page, async () => !!(await navigator.serviceWorker.getRegistration())?.active, null);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('a.sortie', { timeout: 10000 });
  await page.click('a.sortie');
  await page.waitForSelector('#page-detail .courbe', { timeout: 10000 });
  verif('hors ligne : détail avec trace et courbes', !!(await page.$('#carte-parcours path.leaflet-interactive')) && (await page.$$('.courbe')).length === 5);
  await ctx.setOffline(false);

  // Petites cartes : tuiles OpenStreetMap sous le tracé des cartes de la liste
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.waitForSelector('a.sortie .carte-fond img.tuile', { state: 'attached' });
  const srcTuiles = await page.$$eval('a.sortie .carte-fond img.tuile', (els) => els.map((e) => e.getAttribute('src')));
  verif('aperçu sur fond de carte (tuiles OSM)', srcTuiles.length >= 1 && srcTuiles.every((u) => /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(u)), JSON.stringify(srcTuiles));
  verif('mention © OpenStreetMap', (await page.textContent('a.sortie .attribution')) === '© OpenStreetMap');
  // Thème sombre (le test tourne en sombre) : cartes claires quand même, sans filtre
  verif('thème sombre : aperçus de carte sans filtre (clairs)', await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches
    && getComputedStyle(document.querySelector('a.sortie .carte-fond .tuiles')).filter === 'none'));

  // Puissance estimée : même route sans capteur, une semaine plus tard
  await page.setInputFiles('#champ-fichier', { name: 'sans-capteur.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ puissance: false, debutMs: Date.UTC(2025, 4, 17, 7), nom: 'Sans capteur' })) });
  verif('sortie sans capteur importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  await attendre(page, async () => {
    const s = (await (await import('./js/db.js')).toutesLesSorties()).find((x) => x.nom === 'Sans capteur');
    return s?.puissanceEstimee?.normW > 0;
  }, null);
  await page.waitForFunction(() => /≈ \d+ W NP estimée/.test(document.querySelector('a.sortie[href*="gpx-"]')?.textContent ?? document.getElementById('liste').textContent), null, { timeout: 5000 }).catch(() => {});
  const carteSansCapteur = (await page.textContent('a.sortie:has-text("Sans capteur")')).replace(/\s+/g, ' ');
  // moitié à 1,2 % (≈ 257 W), moitié à plat (≈ 150 W) : NP estimée autour de 215 W
  const npEst = Number(carteSansCapteur.match(/≈ (\d+) W NP estimée/)?.[1]);
  verif('liste : NP estimée affichée (≈ 215 W)', npEst >= 195 && npEst <= 235, carteSansCapteur);
  verif('liste : TSS avec la puissance estimée', /TSS \d+/.test(carteSansCapteur), carteSansCapteur);
  await page.click('a.sortie:has-text("Sans capteur")');
  await page.waitForSelector('#page-detail .courbe');
  const titresCourbes = await page.$$eval('.courbe-titre', (els) => els.map((e) => e.textContent.trim()));
  verif('détail : courbe « Puissance estimée »', titresCourbes.includes('Puissance estimée') && !titresCourbes.includes('Puissance'), JSON.stringify(titresCourbes));
  const detailEst = (await page.textContent('#page-detail')).replace(/\s+/g, ' ');
  verif('détail : NP estimée et avertissement', detailEst.includes('NP estimée≈') && detailEst.includes('Pas de capteur de puissance : puissance estimée') && detailEst.includes('Zones de puissance (estimée)'), detailEst.slice(0, 400));
  verif('détail : pas de bloc Puissances pour une estimation', !(await page.$('#bloc-puissances')));
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURES, 'detail-estimee.png'), fullPage: true });

  // Même parcours : 3 sorties sur la même route (avec capteur, sans capteur, avec une pause)
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.setInputFiles('#champ-fichier', { name: 'avec-pause.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ pauseS: 600, debutMs: Date.UTC(2025, 4, 24, 7), nom: 'Avec pause' })) });
  await texteToast(page);
  await page.click('a.sortie:has-text("Sans capteur")');
  await page.waitForSelector('#bloc-meme-parcours:not([hidden])', { timeout: 10000 });
  const resumeMeme = (await page.textContent('#bloc-meme-parcours summary')).replace(/\s+/g, ' ');
  verif('même parcours : replié, classement dans le résumé (2e sur 3, record 59:59)', await page.$eval('#bloc-meme-parcours details.repli', (d) => !d.open)
    && /2e sur 3 · record 59:59/.test(resumeMeme), resumeMeme);
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.locator('#bloc-meme-parcours').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(CAPTURES, 'replis-fermes.png') });
  await ouvrirRepli(page, '#bloc-meme-parcours');
  const memeTxt = (await page.textContent('#bloc-meme-parcours')).replace(/\s+/g, ' ');
  // temps en mouvement : avec pause 3 599 s (1er), les deux autres 3 600 s
  verif('même parcours : fait 3 fois', memeTxt.includes('Fait 3 fois'), memeTxt);
  verif('même parcours : classement, cette sortie mise en avant', /Meilleur temps/.test(memeTxt) && (await page.$$('#bloc-meme-parcours .passage')).length === 3 && !!(await page.$('#bloc-meme-parcours .passage.actuelle')), memeTxt);
  verif('même parcours : 1er = la sortie avec pause (temps en mouvement 59:59)', (await page.textContent('#bloc-meme-parcours .passage')).includes('24 mai 2025'), await page.textContent('#bloc-meme-parcours .passage'));
  await page.evaluate(() => document.getElementById('bloc-meme-parcours').scrollIntoView());
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURES, 'meme-parcours.png') });
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.click('#onglet-progres');
  await page.waitForSelector('#bloc-bilans');
  verif('Progrès : plus de « Mes parcours »', !(await page.$('#bloc-parcours')) && !(await page.textContent('#page-progres')).includes('Mes parcours'));
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURES, 'liste-cartes.png') });

  // Tracés : créer un parcours sur la carte, profil, 3D, enregistrer, GPX
  await page.click('#onglet-traces');
  await page.waitForSelector('#carte-trace.leaflet-container');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  verif('onglet Tracés', (await page.textContent('#titre-page')) === 'Tracés' && (await page.textContent('#trace-etat')).includes('Touche la carte'));
  const zoneCarte = await page.$('#carte-trace');
  const rc = await zoneCarte.boundingBox();
  await page.mouse.click(rc.x + rc.width * 0.3, rc.y + rc.height * 0.7);
  await page.mouse.click(rc.x + rc.width * 0.7, rc.y + rc.height * 0.3);
  await page.waitForSelector('#trace-resume .stats', { timeout: 10000 });
  const statsTrace = (await page.textContent('#trace-resume')).replace(/\s+/g, ' ');
  const kmTrace = Number(statsTrace.match(/Distance\s*([\d,]+)/)[1].replace(',', '.'));
  // le faux BRouter monte de 3 % sur la première moitié : D+ = 1,5 % de la distance
  const dplusTrace = Number(statsTrace.match(/Dénivelé\s*([\d\s]+?)\s*m/)[1].replace(/\s/g, ''));
  verif('tracé : distance et D+ (3 % sur la moitié)', kmTrace > 0.5 && Math.abs(dplusTrace - kmTrace * 15) <= 0.05 * kmTrace * 15 + 2, statsTrace);
  verif('tracé : demande au profil « Route »', demandesBRouter.at(-1) === 'fastbike', JSON.stringify(demandesBRouter));
  verif('tracé : trait et 2 repères sur la carte', (await page.$$('#carte-trace .repere-trace')).length === 2 && !!(await page.$('#carte-trace path.leaflet-interactive')));
  verif('tracé : profil coloré', (await page.$$('.profil-trace rect')).length > 250);
  await page.waitForFunction(() => document.getElementById('nom-trace').value !== '', null, { timeout: 10000 });
  const nomAller = await page.inputValue('#nom-trace');
  verif('nom proposé : aller simple « départ → arrivée »', /^Ville \d+ → Ville \d+$/.test(nomAller), nomAller);
  // Boucle : retour au départ -> distance doublée
  await page.click('[data-a="boucle"]');
  await page.waitForFunction((km1) => {
    const m = document.getElementById('trace-resume').textContent.replace(/\s+/g, ' ').match(/Distance\s*([\d,]+)/);
    return m && Math.abs(Number(m[1].replace(',', '.')) - 2 * km1) < 0.15;
  }, kmTrace, { timeout: 10000 });
  verif('boucle : 3 repères, distance doublée', (await page.$$('#carte-trace .repere-trace')).length === 3);
  await page.waitForFunction(() => document.getElementById('nom-trace').value.startsWith('Boucle'), null, { timeout: 10000 });
  const nomBoucle = await page.inputValue('#nom-trace');
  verif('nom proposé remplacé (pas touché par Cyril) : « Boucle de … »', /^Boucle de Ville \d+( par Ville \d+)?$/.test(nomBoucle), nomBoucle);
  verif('noms : Nominatim et Overpass seulement', demandesLieux.every((u) => /nominatim\.openstreetmap\.org\/reverse|overpass-api\.de/.test(u)), JSON.stringify(demandesLieux.slice(-3)));
  // 3D du tracé
  await page.click('[data-segments="vue-trace"] button[data-valeur="3d"]');
  await page.waitForTimeout(500);
  const pixels3d = await page.$eval('#trace-3d canvas', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  verif('tracé : vue 3D dessinée', pixels3d > 3000, String(pixels3d));
  await page.click('[data-segments="vue-trace"] button[data-valeur="profil"]');
  // Panne de réseau (profil « tranquille ») : message clair, le tracé reste
  await page.selectOption('#profil-route', 'safety');
  await page.waitForFunction(() => document.getElementById('trace-etat').textContent.includes('Calcul impossible'), null, { timeout: 10000 });
  verif('sans réseau : message et conseil « Ligne droite »', (await page.textContent('#trace-etat')).includes('Ligne droite'));
  // Ligne droite : sans réseau ni altitude
  const avant = demandesBRouter.length;
  await page.selectOption('#profil-route', 'droit');
  await page.waitForFunction(() => document.getElementById('trace-etat').textContent.includes('Ligne droite'), null, { timeout: 10000 });
  verif('ligne droite : aucune demande en ligne, pas de profil', demandesBRouter.length === avant && (await page.textContent('#trace-profil')).includes('Pas d\'altitude'));
  await page.selectOption('#profil-route', 'fastbike');
  await page.waitForSelector('.profil-trace', { timeout: 10000 });
  // Enregistrer puis exporter le GPX
  await page.fill('#nom-trace', 'Boucle « test » & co');
  await page.click('[data-a="enregistrer"]');
  verif('tracé enregistré', (await texteToast(page)).includes('Boucle « test » & co'));
  verif('liste « Mes tracés »', (await page.textContent('#mes-traces')).includes('Boucle « test » & co'));
  verif('Mes tracés : aperçu du tracé sur fond de carte', !!(await page.$('#mes-traces .trace-apercu .apercu.carte-fond path.apercu-trace')) && (await page.$$('#mes-traces .trace-apercu img.tuile')).length > 0);
  // Tracé enregistré avant les aperçus (index sans « apercu ») : aperçu calculé au premier affichage et gardé
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    await db.ecrireReglage('traces', (await db.lireReglage('traces')).map(({ apercu, ...t }) => t));
  });
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.click('#onglet-traces');
  await page.waitForSelector('#mes-traces .trace-apercu path.apercu-trace');
  verif('ancien tracé : aperçu rattrapé et gardé dans l\'index', await page.evaluate(async () => ((await (await import('./js/db.js')).lireReglage('traces'))[0].apercu?.length ?? 0) > 10));
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.locator('#mes-traces .trace-carte').first().screenshot({ path: path.join(CAPTURES, 'traces-apercu.png') });
  const [dlGpx] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="gpx"]')]);
  const cheminGpx = path.join(CAPTURES, 'trace-test.gpx');
  await dlGpx.saveAs(cheminGpx);
  const contenuGpx = fs.readFileSync(cheminGpx, 'utf8');
  verif('GPX : nom du fichier et contenu', dlGpx.suggestedFilename() === 'boucle-test-co.gpx' && contenuGpx.includes('<name>Boucle « test » &amp; co</name>') && (contenuGpx.match(/<trkpt /g) || []).length > 10 && contenuGpx.includes('<ele>'), dlGpx.suggestedFilename());
  await page.waitForFunction(() => document.getElementById('toast').hidden || true);
  await page.screenshot({ path: path.join(CAPTURES, 'traces.png'), fullPage: true });
  // Le tracé est gardé : nouveau tracé, puis réouverture depuis la liste
  await page.click('[data-a="nouveau"]');
  verif('nouveau tracé : vide', (await page.$$('#carte-trace .repere-trace')).length === 0);
  await page.click('#mes-traces [data-t="ouvrir"]');
  await page.waitForSelector('#trace-resume .stats');
  verif('réouverture du tracé', (await page.inputValue('#nom-trace')) === 'Boucle « test » & co' && (await page.$$('#carte-trace .repere-trace')).length === 3);

  // Vent : demain, chaque heure de 6 h à 20 h, les deux sens, la meilleure heure
  verif('bloc vent affiché, couleurs inactives avant la prévision', await page.isVisible('#bloc-vent') && await page.$eval('#couleurs-vent', (c) => c.disabled));
  await page.selectOption('#jour-vent', '1');
  await page.click('[data-a="vent"]');
  await page.waitForSelector('.vent-conseil', { timeout: 15000 });
  const urlMeteo = new URL(demandesMeteo.at(-1));
  verif('météo : une seule demande, une trentaine de points au plus, vent et pluie', demandesMeteo.length === 1 && urlMeteo.searchParams.get('latitude').split(',').length <= 31
    && urlMeteo.searchParams.get('hourly').includes('wind_direction_10m') && urlMeteo.searchParams.get('hourly').includes('precipitation_probability'), demandesMeteo.at(-1));
  const lignesVent = await page.$$eval('.vent-tableau tbody tr', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  verif('15 heures de départ (6 h à 20 h)', lignesVent.length === 15 && lignesVent[0].startsWith('6 h') && lignesVent[14].startsWith('20 h'), JSON.stringify(lignesVent.slice(0, 2)));
  const conseil = (await page.textContent('.vent-conseil')).replace(/\s+/g, ' ');
  // heure de Paris = UTC + 1 : vent faible dès 13 h ; pluie à 16 h et 17 h
  const heureConseil = Number(conseil.match(/Pars à (\d+) h/)?.[1]);
  // 18 h à 20 h : retour après la nuit tombée (coucher vers 17 h en novembre) -> écartées
  verif('meilleure heure : vent faible, sans pluie, de jour (13 h, 14 h ou 15 h)', [13, 14, 15].includes(heureConseil), conseil);
  verif('conseil : lever, coucher, retour avant la nuit ; risque de pluie', /☀ Lever \d+ h \d+ · coucher 1[67] h \d+ : retour vers .* avant la nuit/.test(conseil) && /🌧 Pluie : risque (faible|possible)/.test(conseil), conseil);
  const lignesNuit = await page.$$eval('.vent-tableau tbody tr', (els) => els.map((e) => [e.textContent.trim().split(/\s+/).slice(0, 2).join(' '), e.classList.contains('nuit'), e.querySelector('td:nth-child(5)').className]));
  const ligneDe = (h) => lignesNuit.find(([t]) => t.startsWith(`${h} h`));
  verif('tableau : 6 h et 20 h de nuit (🌙), 10 h de jour ; 16 h et 17 h pluie probable', ligneDe(6)[1] && ligneDe(20)[1] && !ligneDe(10)[1]
    && ligneDe(16)[2] === 'pluie-probable' && ligneDe(17)[2] === 'pluie-probable' && ligneDe(10)[2] === 'pluie-faible', JSON.stringify(lignesNuit));
  verif('conseil : vent moyen du nord-est', conseil.includes('du nord-est'), conseil);
  // Températures : départ à 200 m (15 − 1,3 = 13,7 °C), point haut au milieu de la boucle (3 % de montée)
  verif('météo : altitude des points envoyée', (urlMeteo.searchParams.get('elevation') ?? '').split(',').length === urlMeteo.searchParams.get('latitude').split(',').length);
  const temps = await page.$$eval('.vent-temperatures .temp-cases > div', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const altHaut = Number((temps[1] ?? '').match(/· ([\d\s ]+) m/)?.[1].replace(/\s/g, ''));
  verif('températures : départ 14 °C (200 m), point haut corrigé de l\'altitude, arrivée 14 °C', temps.length === 3 && /^Départ ?14 °C.*200 m/.test(temps[0])
    && new RegExp(`^Point haut ?${Math.round(15 - 0.0065 * altHaut)} °C`).test(temps[1]) && altHaut > 300 && /^Arrivée ?14 °C/.test(temps[2]), JSON.stringify(temps));
  // Couleurs du vent sur la 3D
  await page.check('#couleurs-vent');
  await page.click('[data-segments="vue-trace"] button[data-valeur="3d"]');
  await page.waitForTimeout(600);
  verif('3D : légende du vent', await page.$eval('#trace-3d .v3d-legende', (l) => l.classList.contains('vent') && l.textContent.includes('dans le dos') && l.textContent.includes('de face')));
  const couleursRuban = await page.$eval('#trace-3d canvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const vu = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const hex = '#' + [d[i], d[i + 1], d[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (['#b2182b', '#ef8a62', '#bababa', '#67a9cf', '#2166ac'].includes(hex)) vu.add(hex);
    }
    return [...vu];
  });
  verif('3D : ruban aux couleurs du vent', couleursRuban.length >= 1, JSON.stringify(couleursRuban));
  // Choisir une autre heure (6 h, vent fort) : le ruban change de couleurs
  await page.click('.vent-tableau tbody tr >> nth=0');
  verif('heure choisie mise en avant', await page.$eval('.vent-tableau tbody tr', (tr) => tr.classList.contains('choisie')));
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.screenshot({ path: path.join(CAPTURES, 'traces-vent.png'), fullPage: true });
  await page.uncheck('#couleurs-vent');
  verif('décoché : couleurs de pente', await page.$eval('#trace-3d .v3d-legende', (l) => !l.classList.contains('vent') && l.textContent.includes('> 10 %')));
  await page.click('[data-segments="vue-trace"] button[data-valeur="profil"]');

  // Heure précise : 5 h 30 (avant 6 h) ajoutée au tableau, choisie, gardée avec le tracé, dans le GPX
  await page.fill('#heure-depart', '05:30');
  await page.waitForFunction(() => document.querySelectorAll('.vent-tableau tbody tr').length === 16, null, { timeout: 15000 });
  const premiere = await page.$eval('.vent-tableau tbody tr', (tr) => ({ t: tr.textContent.replace(/\s+/g, ' ').trim(), c: tr.className }));
  verif('heure précise : 5 h 30 en tête du tableau, choisie', premiere.t.startsWith('5 h 30') && premiere.c.includes('perso') && premiere.c.includes('choisie'), JSON.stringify(premiere));
  const conseilPerso = (await page.textContent('.vent-conseil')).replace(/\s+/g, ' ');
  verif('conseil : durée à ton heure', conseilPerso.includes('À 5 h 30 (ton heure)'), conseilPerso);
  await page.screenshot({ path: path.join(CAPTURES, 'traces-heure.png'), fullPage: true });
  await page.click('[data-a="enregistrer"]');
  await texteToast(page);
  await attendre(page, async () => !!(await (await import('./js/db.js')).lireReglage('traces'))?.[0]?.departMs, null, 5000).catch(() => {});
  await page.waitForFunction(() => document.getElementById('mes-traces').textContent.includes('départ prévu'), null, { timeout: 5000 }).catch(() => {});
  verif('liste : départ prévu', /départ prévu .* à 5 h 30/.test(await page.textContent('#mes-traces')), JSON.stringify(await page.evaluate(async () => {
    const db = await import('./js/db.js');
    return { index: await db.lireReglage('traces'), heure: document.getElementById('heure-depart').value, jour: document.getElementById('jour-vent').value };
  })));
  const [dlHeure] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="gpx"]')]);
  const cheminHeure = path.join(CAPTURES, 'trace-heure.gpx');
  await dlHeure.saveAs(cheminHeure);
  const tGpx = fs.readFileSync(cheminHeure, 'utf8').match(/<metadata>.*<time>([^<]+)<\/time>/)?.[1];
  const attendu = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(5, 30, 0, 0); return d.toISOString().replace('.000', ''); });
  verif('GPX : heure de départ prévue (demain 5 h 30)', tGpx === attendu, `${tGpx} / ${attendu}`);
  await page.click('[data-a="nouveau"]');
  await page.click('#mes-traces [data-t="ouvrir"]');
  await page.waitForSelector('#trace-resume .stats');
  verif('réouverture : heure et jour repris', (await page.inputValue('#heure-depart')) === '05:30' && (await page.inputValue('#jour-vent')) === '1');

  // Segments sur le tracé : un segment fait d'un morceau du tracé enregistré
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const { decouperSegment } = await import('./js/segments-calc.js');
    const index = await db.lireReglage('traces');
    const t = await db.lireReglage(`trace:${index[0].id}`);
    const pts = t.coords.map((c) => ({ lat: c[0], lon: c[1], altitudeM: c[2] }));
    const i0 = Math.round(pts.length * 0.1); const i1 = Math.round(pts.length * 0.35);
    const seg = { id: 'seg-trace', nom: 'Montée du tracé', ...decouperSegment(pts, i0, i1), type: 'Montée', creeLe: Date.now(), analyseFaite: true };
    await db.ecrireReglage('segments', [...((await db.lireReglage('segments')) ?? []), seg]);
  });
  await page.click('[data-a="nouveau"]');
  await page.click('#mes-traces [data-t="ouvrir"]');
  await ouvrirRepli(page, '#segments-trace');
  await page.waitForSelector('#segments-trace .passage', { timeout: 10000 });
  verif('segments du tracé : résumé « 1 segment · 1 pas encore fait »', (await page.textContent('#segments-trace summary')).includes('1 segment · 1 pas encore fait'));
  const segTrace = (await page.textContent('#segments-trace')).replace(/\s+/g, ' ');
  verif('segments sur le tracé : nom, position, pas encore fait, temps estimé', /Montée du tracé\s*km [\d,]+ → [\d,]+.*Pas encore fait.*Temps estimé à \d+ W/.test(segTrace), segTrace);
  verif('segment en bleu sur la carte du tracé', !!(await page.$('#carte-trace .trait-segment')));
  await page.click('#segments-trace [data-seg-voir]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(CAPTURES, 'traces-segments.png'), fullPage: true });
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    await db.ecrireReglage('segments', ((await db.lireReglage('segments')) ?? []).filter((g) => g.id !== 'seg-trace'));
  });
  // Importer un GPX existant dans la bibliothèque de tracés
  const gpxImporte = `<?xml version="1.0"?><gpx><trk><name>Tour du lac (ami)</name><trkseg>${Array.from({ length: 40 }, (_, k) =>
    `<trkpt lat="${(45.3 + k * 0.002).toFixed(4)}" lon="${(5.9 + Math.sin(k / 6) * 0.01).toFixed(4)}"><ele>${300 + k * 5}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  await page.setInputFiles('#importer-gpx', [{ name: 'tour-du-lac.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxImporte) },
    { name: 'vide.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx></gpx>') }]);
  const toastImport = await texteToast(page);
  verif('import GPX : 1 tracé importé, le fichier vide signalé', toastImport.includes('1 tracé importé') && toastImport.includes('vide.gpx'), toastImport);
  await page.waitForFunction(() => document.getElementById('nom-trace').value === 'Tour du lac (ami)', null, { timeout: 5000 });
  verif('import GPX : ouvert dans l\'éditeur, distance et D+ du fichier', (await page.textContent('#trace-etat')).includes('importé d\'un GPX')
    && /Dénivelé\s*195/.test((await page.textContent('#trace-resume')).replace(/\s+/g, ' ')) && (await page.textContent('#mes-traces')).includes('Tour du lac (ami)'),
  (await page.textContent('#trace-resume')).replace(/\s+/g, ' '));
  verif('import GPX : aperçu dans la liste', !!(await page.$('#mes-traces .trace-carte:first-child .trace-apercu path.apercu-trace')));
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');

  // Transitions natives (View Transitions) : sens « avant », « retour », « onglet »
  await page.evaluate(() => {
    window.__sens = [];
    new MutationObserver(() => window.__sens.push(document.documentElement.dataset.sens))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-sens'] });
  });
  verif('Chrome gère les transitions natives', await page.evaluate(() => typeof document.startViewTransition === 'function'));
  await page.click('a.sortie');
  await page.waitForSelector('#page-detail .courbe');
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.click('#onglet-progres');
  await page.waitForSelector('#bloc-bilans');
  const sensVus = await page.evaluate(() => window.__sens);
  verif('transitions : avant, retour, onglet', JSON.stringify(sensVus) === JSON.stringify(['avant', 'retour', 'onglet']), JSON.stringify(sensVus));
  verif('onglets fixes pendant la transition', await page.evaluate(() => getComputedStyle(document.querySelector('.onglets')).viewTransitionName === 'onglets'));
  verif('barres du bilan animées', (await page.$eval('.bilan-barre', (b) => getComputedStyle(b).animationName)) === 'pousse');
  // Android réglé sur « réduire les animations » : quasi instantané
  const sobre = await browser.newPage({ reducedMotion: 'reduce' });
  await sobre.goto(URL_APPLI);
  const duree = await sobre.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'entree-droite';
    document.body.append(d);
    return getComputedStyle(d).animationDuration;
  });
  verif('animations coupées si l\'on demande moins d\'animations', duree === '0.001s', duree);
  await sobre.close();

  // Réglage automatique de la FTP : sortie d'il y a 2 jours à 300 W pendant 1 h -> 95 % de 300 W = 285 W
  await page.goto(URL_APPLI);
  await page.waitForSelector('#accueil:not([hidden])');
  const ftpAvantAuto = await page.evaluate(async () => (await (await import('./js/profil.js')).lireProfil()).ftpW);
  await page.setInputFiles('#champ-fichier', { name: 'ftp.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ lon: 6.1, puissanceW: 300, debutMs: Date.now() - 2 * 86400000, nom: 'Sortie à 300 W' })) });
  await attendre(page, async () => (await (await import('./js/db.js')).toutesLesSorties()).some((x) => x.nom === 'Sortie à 300 W'), null);
  verif('sortie à 300 W importée', true);
  await attendre(page, async () => (await (await import('./js/profil.js')).lireProfil()).ftpW === 285, null);
  // le message de la FTP remplace celui de l'import
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('FTP réglée'), null, { timeout: 10000 });
  const toastFtp = await texteToast(page);
  verif(`FTP réglée automatiquement : ${ftpAvantAuto} → 285 W, avec un message`, /FTP réglée automatiquement : \d+ → 285 W/.test(toastFtp), toastFtp);
  await page.click('#onglet-profil');
  await page.waitForSelector('#champ-ftp');
  verif('Profil : FTP 285 W, case cochée, dernière hausse', (await page.inputValue('#champ-ftp')) === '285' && await page.isChecked('#ftp-auto')
    && (await page.textContent('#ftp-auto-aide')).includes('→ 285 W'));
  // Plus faible ensuite (250 W) : la FTP ne baisse pas
  await page.uncheck('#ftp-auto');
  verif('case décochée : coupé', (await texteToast(page)).includes('coupé') && await page.evaluate(async () => (await (await import('./js/db.js')).lireReglage('ftpAuto')) === false));
  await page.check('#ftp-auto');
  verif('recochée : FTP pas dépassée, inchangée', (await texteToast(page)).includes('pas dépassée') && (await page.inputValue('#champ-ftp')) === '285');
  await page.screenshot({ path: path.join(CAPTURES, 'ftp-auto.png') });

  // Longue liste : 30 sorties d'abord, la suite en descendant, retour instantané, mise à jour discrète
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');
  const nReel = await page.locator('a.sortie').count();
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const trace = Array.from({ length: 40 }, (_, i) => [45 + 0.001 * i, 5 + 0.0005 * i]);
    for (let k = 0; k < 100; k++) {
      await db.enregistrerSortie({ id: `longue-${k}`, nomFichier: `l${k}.fit`, debut: Date.UTC(2020, 0, 1) + k * 86400000, sport: 2, sousSport: 0, nomSport: 'Vélo',
        dureeChronoS: 3600, dureeTotaleS: 3600, distanceM: 30000, denivelePosM: 300, nbPoints: 40, nbTours: 0, trace }, null);
    }
  });
  await page.reload();
  await page.waitForSelector('a.sortie');
  await page.waitForTimeout(500);
  const premier = await page.locator('a.sortie').count();
  verif('longue liste : seulement 30 cartes dessinées au départ (reste annoncé)', premier === 30 && (await page.textContent('#liste-suite')).includes('Encore'), `${premier} / ${await page.textContent('#liste-suite')}`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction((n) => document.querySelectorAll('a.sortie').length > n, 30, { timeout: 10000 });
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(250); }
  const total = await page.locator('a.sortie').count();
  verif('en descendant : toutes les sorties arrivent, plus de message', total === nReel + 100 && (await page.textContent('#liste-suite')) === '', `${total} / ${nReel + 100}`);
  const cumulsLongue = await page.$$eval('.mois-cumul', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  verif('totaux des mois calculés sur toutes les sorties (janvier 2020 : 31 sorties)', cumulsLongue.some((t) => t.startsWith('31 sorties · 930 km')), JSON.stringify(cumulsLongue.slice(-3)));
  // (on attend la fin des calculs en arrière-plan sur les 100 sorties ajoutées, puis la liste se met à jour)
  await attendre(page, async () => {
    const db = await import('./js/db.js'); const v = db.versionBase();
    await new Promise((r) => setTimeout(r, 1200));
    return db.versionBase() === v;
  }, null);
  await page.evaluate(async () => (await import('./js/app.js')).rafraichirListe());
  // retour instantané : la liste n'est pas refaite si rien n'a changé
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('a.sortie').dataset.marque = 'oui'; });
  await page.evaluate(() => { location.hash = '#profil'; });
  await page.waitForSelector('#champ-ftp');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  await page.click('#onglet-sorties');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.waitForFunction(() => !document.documentElement.dataset.transition);
  verif('retour sur l\'accueil : liste gardée telle quelle (pas refaite)', (await page.getAttribute('a.sortie', 'data-marque')) === 'oui');
  // calculs en arrière-plan : seules les cartes changées sont refaites
  const refait = await page.evaluate(async () => {
    const cartes = [...document.querySelectorAll('a.sortie')].slice(0, 3);
    cartes.forEach((c, i) => { c.dataset.marque = `m${i}`; });
    const db = await import('./js/db.js');
    const id = cartes[1].dataset.id;
    await db.completerSortie(id, () => ({ nom: 'Nom changé en arrière-plan' }));
    await (await import('./js/app.js')).rafraichirListe();
    return id;
  });
  verif('mise à jour discrète : la carte changée est refaite, les autres gardées', await page.evaluate(() => {
    const c = [...document.querySelectorAll('a.sortie')].slice(0, 3);
    return c[1].textContent.includes('Nom changé') && c[0].dataset.marque === 'm0' && c[2].dataset.marque === 'm2' && !c[1].dataset.marque;
  }));

  verif('aucune erreur dans la console', erreursConsole.length === 0, erreursConsole.join(' | '));
  await browser.close();
  srv.close();
  console.log(`\n${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})();
