// Tests de la création de parcours : adresse BRouter, réponse, GPX, dénivelé,
// temps estimé. Valeurs calculées à la main. Lancer : node tests/test-routage.mjs
import {
  urlBRouter, lireReponseBRouter, traceDroite, denivele, vitessePourPuissance, tempsEstimeS,
  gpxDepuisTrace, nomFichierGpx, calculerRoute, longueurTrace,
} from '../js/routage.js';
import { lireGpx } from '../js/trace.js';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};
const proche = (nom, obtenu, attendu, tol) => {
  const ok = Math.abs(obtenu - attendu) <= tol;
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${obtenu}, attendu ${attendu} ± ${tol}`}`);
  if (!ok) echecs++;
};

// Adresse BRouter : lon,lat séparés par |
egal('adresse BRouter', urlBRouter([[45.1885, 5.7245], [45.2, 5.75]], 'fastbike'),
  'https://brouter.de/brouter?lonlats=5.724500,45.188500|5.750000,45.200000&profile=fastbike&alternativeidx=0&format=geojson');

// Réponse GeoJSON (forme renvoyée par BRouter : [lon, lat, altitude], propriétés en texte)
const reponse = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { 'track-length': '2513', 'filtered ascend': '87', 'total-time': '600' },
    geometry: { type: 'LineString', coordinates: [[5.7245, 45.1885, 210], [5.73, 45.19, 250], [5.75, 45.2, 297]] } }],
};
const lu = lireReponseBRouter(reponse);
egal('réponse : points en [lat, lon, alt]', lu.coords[0], [45.1885, 5.7245, 210]);
egal('réponse : longueur et D+ de BRouter', [lu.distanceM, lu.denivelePosM], [2513, 87]);
let erreur = '';
try { lireReponseBRouter({ features: [] }); } catch (e) { erreur = e.message; }
egal('réponse vide : erreur lisible', erreur, 'réponse du calcul de route illisible');

// Ligne droite : 1 km plein nord
const droit = traceDroite([[45, 5], [45 + 1000 / 111195, 5]]);
proche('ligne droite : 1 000 m', droit.distanceM, 1000, 0.5);
egal('ligne droite : pas d\'altitude', [droit.denivelePosM, denivele(droit.coords).avecAltitude], [null, false]);

// Dénivelé : seuil de 2 m (le bruit de 1 m n'est pas compté)
egal('dénivelé', denivele([[0, 0, 100], [0, 0, 101], [0, 0, 100], [0, 0, 110], [0, 0, 105], [0, 0, 120]]), { plus: 25, moins: 5, avecAltitude: true });

// Vitesse à puissance constante (106 kg) : à plat, 150 W ≈ 30 km/h (150,3 W calculés à 30 km/h)
proche('150 W à plat ≈ 30 km/h', vitessePourPuissance(150.3, 0, 106) * 3.6, 30, 0.05);
// À 8 % : 150 W -> environ 6,1 km/h (le poids domine)
const v8 = vitessePourPuissance(150, 0.08, 106);
proche('150 W à 8 % : puissance retrouvée', (106 * 9.81 * (0.004 * Math.cos(Math.atan(0.08)) + Math.sin(Math.atan(0.08))) * v8 + 0.5 * 1.2 * 0.32 * v8 ** 3) / 0.97, 150, 0.01);
egal('descente raide : limitée à 60 km/h', Math.round(vitessePourPuissance(150, -0.12, 106) * 3.6), 60);

// Temps estimé : 30 km plein nord, à plat, 150,3 W -> 3 600 s
const plat = [];
for (let d = 0; d <= 30000; d += 100) plat.push([45 + d / 111195, 5, 200]);
proche('30 km à plat à 150 W : 1 h', tempsEstimeS(plat, 150.3, 98), 3600, 5);
// Montée de 10 km à 6 % : plus lent qu'à plat
const montee = [];
for (let d = 0; d <= 10000; d += 50) montee.push([45 + d / 111195, 5, 200 + d * 0.06]);
const tMontee = tempsEstimeS(montee, 150, 98);
const vMontee = vitessePourPuissance(150, 0.06, 106);
proche('10 km à 6 % : temps = distance / vitesse', tMontee, 10000 / vMontee, 30);

// GPX : relu par le lecteur de l'appli, nom échappé
const gpx = gpxDepuisTrace('Boucle « Vercors » & cols', lu.coords);
egal('GPX : nom échappé', gpx.includes('<name>Boucle « Vercors » &amp; cols</name>'), true);
egal('GPX : 3 points avec altitude', (gpx.match(/<trkpt /g) || []).length === 3 && gpx.includes('<ele>297.0</ele>'), true);
egal('GPX : type vélo', lireGpx(gpx.replace(/<trkpt ([^>]+)>/g, '<trkpt $1><time>2026-11-05T10:00:00Z</time>')).sport, 2);
egal('nom de fichier', nomFichierGpx('Boucle du Vercors (été)'), 'boucle-du-vercors-ete.gpx');

// Calcul de route : réseau simulé
const ok = await calculerRoute([[45.1885, 5.7245], [45.2, 5.75]], 'trekking', async () => ({ ok: true, json: async () => reponse }));
egal('calcul de route (réponse simulée)', ok.distanceM, 2513);
let msg = '';
try { await calculerRoute([[45, 5], [45.1, 5]], 'fastbike', async () => { throw new TypeError('Failed to fetch'); }); } catch (e) { msg = e.message; }
egal('sans réseau : message clair', msg, 'pas de réseau ou service de calcul de route injoignable');
egal('profil « ligne droite » : pas de réseau', (await calculerRoute([[45, 5], [45.01, 5]], 'droit', () => { throw new Error('appel interdit'); })).coords.length, 2);
proche('longueur d\'une trace', longueurTrace([[45, 5], [45 + 500 / 111195, 5], [45 + 1500 / 111195, 5]]), 1500, 0.5);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
