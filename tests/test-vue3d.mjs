// Tests des calculs de la vue 3D (trace rééchantillonnée, pentes, curseur).
// Lancer : node tests/test-vue3d.mjs
import { construireTrace, donnees3d, GCOL } from '../js/vue3d.js';
import { pointsDetail } from '../js/analyse.js';
import { lireGpx } from '../js/trace.js';
import { fauxGpx } from './fausse-archive.mjs';

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

// Sortie fabriquée : 30 km plein nord ; +1 m toutes les 10 s pendant 30 min
// (à 30 km/h : +180 m sur 15 km = 1,2 %), puis plat
const pts = pointsDetail(lireGpx(fauxGpx()).records);
const T = construireTrace(pts);
proche('longueur de la trace (m)', T.tot, 30000, 30); // projection plane : à 0,1 % près
egal('un point tous les 5 m', T.n, Math.floor(T.tot / 5) + 1);
egal('pas une boucle', T.loop, false);
egal('altitude présente', T.avecAltitude, true);
proche('pente au milieu de la montée (%)', T.G[Math.round(7500 / 5)], 1.2, 0.15);
proche('pente sur le plat (%)', T.G[Math.round(22500 / 5)], 0, 0.15);
proche('altitude au départ (m)', T.E[0], 100, 3);
proche('altitude après la montée (m)', T.E[Math.round(25000 / 5)], 280, 3);
// Curseur : distance le long de la trace du point de la sortie
proche('curseur : point de 30 min -> 15 km', T.sPoint[1800], 15000, 20);
proche('curseur : dernier point -> fin de trace', T.sPoint[pts.length - 1], T.tot, 0.01);
const D = donnees3d(T);
proche('point culminant (m)', D.hi, 280, 3);
proche('D+ de la trace lissée (m)', D.dp, 180, 8);

// Boucle : départ et arrivée à moins de 120 m
const t0 = Date.UTC(2026, 9, 12, 8);
const boucle = Array.from({ length: 361 }, (_, i) => {
  const a = (i / 360) * 2 * Math.PI;
  return { horodatage: new Date(t0 + i * 10000), lat: 45 + 0.02 * Math.sin(a), lon: 5.7 + 0.03 * (1 - Math.cos(a)), altitudeM: 300 + 50 * Math.sin(a) };
});
const TB = construireTrace(pointsDetail(boucle));
egal('boucle détectée', TB.loop, true);
// Sans GPS : pas de 3D
egal('sans GPS : pas de trace', construireTrace(pointsDetail([{ horodatage: new Date(t0) }, { horodatage: new Date(t0 + 1000) }])), null);
// Sans altitude : à plat
const plat = construireTrace(pointsDetail(boucle.map(({ altitudeM, ...p }) => p)));
egal('sans altitude : affichée à plat', [plat.avecAltitude, Math.max(...plat.E)], [false, 0]);

// Couleurs de pente (identiques à Parcours 3D)
egal('couleurs', [GCOL(-8), GCOL(-3), GCOL(0), GCOL(3), GCOL(5), GCOL(7), GCOL(9), GCOL(12)],
  ['#2f6fc4', '#4a9be0', '#4cc35a', '#b5d63a', '#f2c230', '#f08a24', '#e0402a', '#9c1f3c']);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
