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
    const lieu = { hourly: { time, temperature_2m: time.map(() => 10), wind_speed_10m: time.map((t) => (h(t) < 12 ? 25 : 8)),
      wind_direction_10m: time.map(() => 45), wind_gusts_10m: time.map(() => 30), precipitation_probability: time.map((t) => (h(t) === 15 || h(t) === 16 ? 80 : 0)) } };
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(n === 1 ? lieu : Array(n).fill(lieu)) });
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
  await ctx.route(/tile\.openstreetmap\.org/, (r) => { tuilesDemandees.push(r.request().url()); r.fulfill({ status: 200, contentType: 'image/png', body: fausseTuile() }); });
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
  verif('menu Activité inactif sans sortie', await page.$eval('#choix-activite', (s) => s.disabled));

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
  verif('point du curseur sur la carte', await page.evaluate(() => [...document.querySelectorAll('#carte-parcours path.leaflet-interactive')].length >= 4));
  const detail = (await page.textContent('#page-detail')).replace(/\s+/g, ' ');
  for (const m of ['5 s200W', '1 min200W', '20 min200W', '1 h200W', 'Puissance normalisée200 W', "Facteur d'intensité0,85", 'TSS72',
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
  await page.waitForSelector('#bloc-segments-sortie .bloc-titre');
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
  const choixTxt = (await page.textContent('#bloc-segments-sortie .creation')).replace(/\s+/g, ' ');
  verif('départ et arrivée choisis (km 10 et km 20)', /Départ : km 10,0\d · Arrivée : km 20,0\d · 10,0 km/.test(choixTxt), choixTxt);
  await page.fill('#nom-segment', 'Faux plat du test');
  await page.click('[data-creer]');
  verif('segment créé, 1 passage', (await texteToast(page)).includes('1 passage trouvé'));
  await page.waitForSelector('#bloc-segments-sortie .passage');
  const passageTxt = (await page.textContent('#bloc-segments-sortie .passage')).replace(/\s+/g, ' ');
  // 10 km à 30 km/h = 20 min
  verif('passage : 20:00, record perso, 200 W', /Faux plat du test.*20:0\d.*Record perso.*30,0 km\/h.*200 W/.test(passageTxt), passageTxt);

  // Nouvelle sortie sur la même route, une semaine après, avec une pause de 10 min au km 15
  await page.setInputFiles('#champ-fichier', { name: 'col-bis.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ pauseS: 600, debutMs: Date.UTC(2025, 4, 17, 7), nom: 'Col du test bis' })) });
  verif('sortie bis importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  await page.waitForFunction(async () => (await (await import('./js/segments.js')).lirePassages()).length === 2, null, { timeout: 20000 });
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
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  await page.click('#onglet-progres');
  await page.waitForSelector('#bloc-segments .passage');
  verif('Progrès : mes segments', (await page.textContent('#bloc-segments')).replace(/\s+/g, ' ').includes('2 passages'));
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

  // « Voir » une montée détectée : carte de la sortie avec le segment en bleu, puis 3D du segment seul
  await page.setInputFiles('#champ-fichier', { name: 'montee.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ montee: true, lon: 5.7, debutMs: Date.UTC(2025, 4, 18, 7), nom: 'Montée à voir' })) });
  verif('sortie avec montée importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  const idMontee = await page.evaluate(async () => (await (await import('./js/db.js')).toutesLesSorties()).find((x) => x.nom === 'Montée à voir').id);
  await page.goto(URL_APPLI + '#sortie=' + encodeURIComponent(idMontee));
  await page.waitForSelector('#bloc-segments-sortie .proposition');
  const propTxt = (await page.textContent('#bloc-segments-sortie .proposition')).replace(/\s+/g, ' ');
  verif('montée détectée (3 km à 6 %), boutons Voir et Suivre', /Montée du km 5,\d.*à [56],\d %.*Voir.*Suivre/.test(propTxt), propTxt);
  await page.click('#bloc-segments-sortie [data-voir="0"]');
  await page.waitForSelector('#bloc-segments-sortie .carte-segment .trait-segment', { state: 'attached' });
  const traits = await page.$$eval('#bloc-segments-sortie .carte-segment path.leaflet-interactive', (ps) => ps.map((p) => p.getAttribute('stroke')));
  verif('carte : la sortie en orange, le segment en bleu par-dessus', traits.includes('#1e88e5') && traits.some((c) => c && c.startsWith('#e')), JSON.stringify(traits));
  const largeurs = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const seg = r('#bloc-segments-sortie .trait-segment');
    const carte = r('#bloc-segments-sortie .carte-segment');
    return { seg: seg.height, carte: carte.height };
  });
  // 3 km sur 30 km de sortie toute droite vers le nord : le segment fait ~1/10 de la hauteur de la carte
  verif('carte cadrée sur toute la sortie (segment ≈ 1/10 de la hauteur)', largeurs.seg > 10 && largeurs.seg < largeurs.carte * 0.2, JSON.stringify(largeurs));
  verif('bouton Fermer', (await page.textContent('#bloc-segments-sortie [data-voir="0"]')) === 'Fermer');
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
  await page.click('#bloc-segments-sortie [data-voir="0"]');
  verif('Fermer : aperçu retiré', !(await page.$('#bloc-segments-sortie .apercu-segment')));
  await page.evaluate(async (id) => {
    const db = await (await import('./js/db.js')).ouvrirBase();
    const tx = db.transaction(['sorties', 'fichiers'], 'readwrite');
    tx.objectStore('sorties').delete(id);
    tx.objectStore('fichiers').delete(id);
    await new Promise((ok) => { tx.oncomplete = ok; });
  }, idMontee);

  await page.click('#btn-retour');
  await page.waitForSelector('#onglet-sorties', { state: 'visible' });
  await page.click('#onglet-sorties');
  await page.click('a.sortie:has-text("Col du test")');
  await page.waitForSelector('#page-detail .courbe');

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
  await page.waitForSelector('#choix-velo');
  verif('détail : vélo de la sortie', (await page.$eval('#choix-velo', (s) => s.selectedOptions[0].textContent)) === 'Canyon Endurace');
  await page.selectOption('#choix-velo', { label: 'Home trainer' });
  await page.waitForTimeout(200);
  await page.click('#btn-retour');
  await page.click('#onglet-profil');
  await page.waitForSelector('#bloc-velos .velo');
  const km2 = await page.$$eval('#bloc-velos .velo-km', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
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
  const filtres = async () => page.$$eval('#choix-activite option', (els) => els.map((e) => `${e.textContent.replace(/ \((\d+)\)$/, ' $1')}${e.selected ? '*' : ''}`));
  const choisirActivite = async (nom) => {
    const valeur = await page.$$eval('#choix-activite option', (els, n) => els.find((e) => e.textContent.startsWith(`${n} (`)).value, nom);
    await page.selectOption('#choix-activite', valeur);
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
  await page.reload();
  await page.waitForSelector('#choix-activite option:nth-child(2)', { state: 'attached' });
  verif('tri gardé après réouverture', (await filtres())[1] === 'Vélo 4*' && (await page.$$('.sortie')).length === 4, JSON.stringify(await filtres()));
  await choisirActivite('Musculation');
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
  await page.waitForSelector('#choix-activite option:nth-child(2)', { state: 'attached' });
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
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15000 });
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

  // Puissance estimée : même route sans capteur, une semaine plus tard
  await page.setInputFiles('#champ-fichier', { name: 'sans-capteur.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from(fauxGpx({ puissance: false, debutMs: Date.UTC(2025, 4, 17, 7), nom: 'Sans capteur' })) });
  verif('sortie sans capteur importée', (await texteToast(page)).includes('1 nouvelle sortie'));
  await page.waitForFunction(async () => {
    const s = (await (await import('./js/db.js')).toutesLesSorties()).find((x) => x.nom === 'Sans capteur');
    return s?.puissanceEstimee?.normW > 0;
  }, null, { timeout: 15000 });
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
  verif('détail : pas de meilleurs efforts pour une estimation', !detailEst.includes('Meilleurs efforts'));
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
  await page.waitForSelector('#bloc-parcours');
  const mesParcours = (await page.textContent('#bloc-parcours')).replace(/\s+/g, ' ');
  verif('Progrès : mes parcours (fait 3 fois)', mesParcours.includes('fait 3 fois'), mesParcours);
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
  // Boucle : retour au départ -> distance doublée
  await page.click('[data-a="boucle"]');
  await page.waitForFunction((km1) => {
    const m = document.getElementById('trace-resume').textContent.replace(/\s+/g, ' ').match(/Distance\s*([\d,]+)/);
    return m && Math.abs(Number(m[1].replace(',', '.')) - 2 * km1) < 0.15;
  }, kmTrace, { timeout: 10000 });
  verif('boucle : 3 repères, distance doublée', (await page.$$('#carte-trace .repere-trace')).length === 3);
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
  verif('meilleure heure : vent faible, sans pluie (13 h, 14 h, 15 h, 18 h, 19 h ou 20 h)', [13, 14, 15, 18, 19, 20].includes(heureConseil), conseil);
  verif('conseil : vent moyen du nord-est', conseil.includes('du nord-est'), conseil);
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

  verif('aucune erreur dans la console', erreursConsole.length === 0, erreursConsole.join(' | '));
  await browser.close();
  srv.close();
  console.log(`\n${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})();
