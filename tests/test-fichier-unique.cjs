// Le fichier unique (dist/mes-sorties.html) ouvert directement, sans site web :
// démarrage, import, détail, données gardées après réouverture.
// Lancer : node outils/fichier-unique.mjs && node tests/test-fichier-unique.cjs
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const FICHIER = path.join(__dirname, '..', 'dist', 'mes-sorties.html');
const CAPTURES = path.join(__dirname, 'captures');
let echecs = 0;
const verif = (nom, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — ${detail}`}`); if (!ok) echecs++; };

(async () => {
  const { fauxGpx } = await import('./fausse-archive.mjs');
  fs.mkdirSync(CAPTURES, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const erreurs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|tile\.openstreetmap|net::/.test(m.text())) erreurs.push(m.text()); });
  await page.goto(`file://${FICHIER}`);
  await page.waitForFunction(() => document.getElementById('synchro-titre').textContent !== 'Chargement…');
  verif('démarre depuis un fichier (file://)', (await page.textContent('#titre-page')) === 'Mes sorties' && (await page.textContent('#version')).startsWith('v'));
  verif('aucune demande de fichier voisin (tout est dans le fichier)', await page.evaluate(() =>
    performance.getEntriesByType('resource').every((r) => !r.name.startsWith('file:'))), JSON.stringify(await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.startsWith('file:')))));
  verif('pas de service worker hors d\'un site', await page.evaluate(async () => { try { return (await navigator.serviceWorker.getRegistrations()).length === 0; } catch { return true; } }));
  verif('police des chiffres intégrée', await page.evaluate(async () => { await document.fonts.load("700 30px 'Barlow Condensed'"); return document.fonts.check("700 30px 'Barlow Condensed'"); }));

  await page.setInputFiles('#champ-fichier', { name: 'sortie.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(fauxGpx({ nom: 'Sortie du fichier unique' })) });
  await page.waitForSelector('a.sortie');
  verif('import d\'un GPX : la sortie est dans la liste', (await page.textContent('a.sortie')).includes('Sortie du fichier unique'));
  await page.click('a.sortie');
  await page.waitForSelector('#page-detail .courbe');
  verif('détail : carte Leaflet et courbes', !!(await page.$('#carte-parcours.leaflet-container')) && (await page.$$('#page-detail .courbe')).length >= 4);
  await page.click('[data-segments="vue"] button[data-valeur="3d"]');
  await page.waitForTimeout(500);
  verif('détail : vue 3D', await page.isVisible('#vue3d canvas'));
  await page.click('#btn-retour');
  await page.waitForSelector('#accueil:not([hidden])');
  for (const onglet of ['traces', 'progres', 'profil']) {
    await page.click(`#onglet-${onglet}`);
    await page.waitForFunction(() => !document.documentElement.dataset.transition);
    await page.waitForTimeout(300);
  }
  verif('onglets Tracés, Progrès, Profil ouverts sans erreur', (await page.textContent('#titre-page')) === 'Profil');
  // Sauvegarde : le zip se télécharge
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-sauvegarder')]);
  verif('sauvegarde exportée', /^mes-sorties-sauvegarde-.*\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  await page.goto('about:blank');
  await page.goto(`file://${FICHIER}`);
  await page.waitForSelector('a.sortie');
  verif('données gardées après réouverture du fichier', (await page.textContent('a.sortie')).includes('Sortie du fichier unique'));
  await page.screenshot({ path: path.join(CAPTURES, 'fichier-unique.png') });
  verif('aucune erreur', erreurs.length === 0, erreurs.join(' | '));
  await browser.close();
  console.log(`\n${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})();
