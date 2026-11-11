// Construit « GOATout » en UN SEUL fichier HTML (code, styles, polices,
// Leaflet, JSZip, icône), à ouvrir directement sur le téléphone sans site web.
// Lancer : node outils/fichier-unique.mjs  ->  dist/mes-sorties.html
//
// Différences avec l'appli en ligne (voir README) :
// - pas de service worker : pas de mise à jour automatique, pas de réception
//   des fichiers partagés depuis Gadgetbridge (le menu Partager d'Android) ;
// - pas d'installation comme appli (l'icône s'ajoute par un raccourci) ;
// - les données sont propres à ce fichier : sauvegarder dans l'ancienne appli,
//   puis restaurer dans celle-ci.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (f) => readFileSync(join(racine, f), 'utf8');
const base64 = (f) => readFileSync(join(racine, f)).toString('base64');

// 1. Code de l'appli : les modules réunis en un script classique
const { outputFiles } = await esbuild.build({
  entryPoints: [join(racine, 'js/app.js')],
  bundle: true, format: 'iife', target: 'es2022', minify: true, write: false, charset: 'utf8',
  legalComments: 'none',
});
const icone = `data:image/png;base64,${base64('icons/icone-192.png')}`;
// l'icône (page Profil, image à partager) est intégrée au code
const code = outputFiles[0].text.replace(/icons\/icone-192\.png/g, () => icone);

// 2. Styles : polices et icône en données intégrées
const css = lire('css/app.css').replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_, f) => `url(data:font/woff2;base64,${base64(`fonts/${f}`)})`);
const leafletCss = lire('vendor/leaflet/leaflet.css').replace(/url\(images\/[^)]+\)/g, 'none');

// « </script> » ne doit pas apparaître dans un script intégré
const sur = (js) => js.replace(/<\/script/gi, '<\\/script');

let html = lire('index.html')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icone}" type="image/png">`)
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<link rel="stylesheet" href="vendor\/leaflet\/leaflet.css">/, () => `<style>${leafletCss}</style>`)
  .replace(/<link rel="stylesheet" href="css\/app.css">/, () => `<style>${css}</style>`)
  .replace(/<script src="vendor\/jszip.min.js" defer><\/script>/, () => `<script>${sur(lire('vendor/jszip.min.js'))}</script>`)
  .replace(/<script src="vendor\/leaflet\/leaflet.js" defer><\/script>/, () => `<script>${sur(lire('vendor/leaflet/leaflet.js'))}</script>`)
  // le code de l'appli à la fin du document (il cherche les éléments de la page au démarrage)
  .replace(/\s*<script type="module" src="js\/app.js"><\/script>/, '')
  .replace(/<\/body>/, () => `<script>${sur(code)}</script>\n</body>`);

for (const reste of ['src="js/', 'href="css/', 'src="vendor/', 'manifest.webmanifest']) {
  if (html.includes(reste)) throw new Error(`lien externe restant : ${reste}`);
}
mkdirSync(join(racine, 'dist'), { recursive: true });
writeFileSync(join(racine, 'dist/goatout.html'), html);
console.log(`dist/goatout.html : ${(html.length / 1024).toFixed(0)} Ko`);
